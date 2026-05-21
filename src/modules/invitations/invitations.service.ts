import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { generateVerificationToken, hashToken } from '../../utils/tokens';
import { hashPassword } from '../../utils/password';
import { signAccessToken, signRefreshToken } from '../../utils/jwt';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors';
import { sendEmail } from '../email/email.service';
import { buildFrontendUrl } from '../email/templates';
import type { CreateInvitationInput, AcceptInvitationInput } from './invitations.schemas';
import type { User } from '@prisma/client';
import crypto from 'crypto';

const CURRENT_GDPR_VERSION = '2025-01-01';

interface InvitationMetadata {
  unitId: string;
  communityId: string;
  relationType: 'OWNER' | 'OCCUPANT' | 'BOTH';
}

/**
 * El admin crea una invitación para un vecino.
 * - Verifica que el admin gestiona la comunidad
 * - Crea (o reutiliza) un User en estado INVITED
 * - Crea registro de Ownership y/o Occupancy según relationType
 * - Genera token INVITATION y envía email
 */
export async function createInvitation(
  inviterId: string,
  input: CreateInvitationInput
): Promise<{ invitationId: string; userId: string; sentTo: string }> {
  // 1. Verificar que el inviter es admin de esa comunidad
  const link = await prisma.communityAdmin.findUnique({
    where: { communityId_userId: { communityId: input.communityId, userId: inviterId } },
    include: { community: true, user: true },
  });
  if (!link) {
    throw new ForbiddenError('No gestionas esta comunidad');
  }

  // 2. Verificar que la unidad pertenece a la comunidad
  const unit = await prisma.unit.findFirst({
    where: { id: input.unitId, communityId: input.communityId },
  });
  if (!unit) throw new NotFoundError('La unidad no pertenece a esta comunidad');

  // 3. Buscar o crear usuario
  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  if (existing && existing.status === 'ACTIVE') {
    // Si ya tiene cuenta activa, no creamos invitación: solo vinculamos la unidad
    await linkUserToUnit(existing.id, input);
    throw new ConflictError(
      'Este usuario ya tiene cuenta activa. Se le ha vinculado la nueva unidad sin reenviar invitación.'
    );
  }

  const user =
    existing ??
    (await prisma.user.create({
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        role: 'VECINO',
        status: 'INVITED',
        locale: input.locale,
        invitedById: inviterId,
      },
    }));

  // 4. Crear las relaciones Ownership/Occupancy
  await linkUserToUnit(user.id, input);

  // 5. Generar token y guardar metadata
  const { token, tokenHash } = generateVerificationToken();
  const expiresAt = new Date(Date.now() + env.INVITATION_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

  const metadata: InvitationMetadata = {
    unitId: input.unitId,
    communityId: input.communityId,
    relationType: input.relationType,
  };

  // Invalidamos invitaciones pendientes previas para el mismo usuario
  await prisma.verificationToken.updateMany({
    where: { userId: user.id, type: 'INVITATION', usedAt: null },
    data: { usedAt: new Date() },
  });

  const invitation = await prisma.verificationToken.create({
    data: {
      tokenHash,
      type: 'INVITATION',
      userId: user.id,
      expiresAt,
      metadata: metadata as unknown as object,
    },
  });

  // 6. Enviar email
  await sendEmail({
    to: user.email,
    template: 'invitation',
    locale: user.locale as 'es' | 'en',
    vars: {
      firstName: user.firstName,
      invitedByName: `${link.user.firstName} ${link.user.lastName}`,
      communityName: link.community.name,
      acceptUrl: buildFrontendUrl(`/accept-invitation?token=${encodeURIComponent(token)}`),
      expiresInDays: env.INVITATION_EXPIRES_DAYS,
    },
  });

  return { invitationId: invitation.id, userId: user.id, sentTo: user.email };
}

async function linkUserToUnit(userId: string, input: CreateInvitationInput): Promise<void> {
  const now = new Date();

  // Cerrar ownership/occupancy activos previos del mismo tipo si los hubiera
  if (input.relationType === 'OWNER' || input.relationType === 'BOTH') {
    // Cerrar titularidad activa del mismo usuario en esta unidad si existiera
    const existingOwnership = await prisma.ownership.findFirst({
      where: { unitId: input.unitId, ownerId: userId, endDate: null },
    });
    if (!existingOwnership) {
      await prisma.ownership.create({
        data: { unitId: input.unitId, ownerId: userId, startDate: now },
      });
    }
  }

  if (input.relationType === 'OCCUPANT' || input.relationType === 'BOTH') {
    const existingOccupancy = await prisma.occupancy.findFirst({
      where: { unitId: input.unitId, occupantId: userId, endDate: null },
    });
    if (!existingOccupancy) {
      await prisma.occupancy.create({
        data: {
          unitId: input.unitId,
          occupantId: userId,
          startDate: now,
          isOwner: input.relationType === 'BOTH',
        },
      });
    }
  }
}

/**
 * El invitado consulta el token para ver de qué va antes de aceptar.
 * Devuelve info pública sin sensibles.
 */
export async function inspectInvitation(rawToken: string): Promise<{
  email: string;
  firstName: string;
  communityName: string;
  expiresAt: Date;
}> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.type !== 'INVITATION') {
    throw new NotFoundError('Invitación no encontrada');
  }
  if (record.usedAt) throw new ValidationError('Esta invitación ya ha sido aceptada');
  if (record.expiresAt < new Date()) throw new ValidationError('Esta invitación ha caducado');

  const meta = record.metadata as unknown as InvitationMetadata;
  const community = await prisma.community.findUnique({ where: { id: meta.communityId } });

  return {
    email: record.user.email,
    firstName: record.user.firstName,
    communityName: community?.name ?? '',
    expiresAt: record.expiresAt,
  };
}

/**
 * El invitado acepta: define contraseña y se activa.
 */
export async function acceptInvitation(input: AcceptInvitationInput): Promise<{
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: User['role'] };
}> {
  const tokenHash = hashToken(input.token);
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.type !== 'INVITATION') {
    throw new NotFoundError('Invitación no válida');
  }
  if (record.usedAt) throw new ValidationError('Esta invitación ya fue aceptada');
  if (record.expiresAt < new Date()) throw new ValidationError('Esta invitación ha caducado');

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
        gdprAcceptedAt: new Date(),
        gdprVersion: CURRENT_GDPR_VERSION,
      },
    });
  });

  // Emitir tokens para login automático tras aceptar
  const tokenId = crypto.randomUUID();
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id, tokenId });

  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: {
      id: tokenId,
      token: refreshToken,
      userId: user.id,
      expiresAt: refreshExpiresAt,
    },
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, role: user.role },
  };
}
