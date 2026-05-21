import { prisma } from '../../config/prisma';
import { Prisma, type UserRole } from '@prisma/client';
import { ForbiddenError, NotFoundError } from '../../utils/errors';
import { assertCommunityAccess } from '../../utils/authz';
import type {
  CreateProcedureInput,
  UpdateProcedureInput,
  AddUpdateInput,
  ListProceduresQuery,
} from './procedures.schemas';

async function residentBelongsToCommunity(userId: string, communityId: string): Promise<boolean> {
  const [own, occ] = await Promise.all([
    prisma.ownership.count({ where: { ownerId: userId, endDate: null, unit: { communityId } } }),
    prisma.occupancy.count({ where: { occupantId: userId, endDate: null, unit: { communityId } } }),
  ]);
  return own > 0 || occ > 0;
}

async function isCommunityAdmin(userId: string, userRole: UserRole, communityId: string): Promise<boolean> {
  if (userRole === 'SUPPORT') return true;
  if (userRole !== 'ADMIN_FINCAS') return false;
  const link = await prisma.communityAdmin.findUnique({
    where: { communityId_userId: { communityId, userId } },
  });
  return !!link;
}

// ─── Crear (vecino) ─────────────────────────────────────────

export async function createProcedure(userId: string, input: CreateProcedureInput) {
  const belongs = await residentBelongsToCommunity(userId, input.communityId);
  if (!belongs) throw new ForbiddenError('No perteneces a esta comunidad');

  // Si indica unidad, validar que pertenece a la comunidad
  if (input.unitId) {
    const unit = await prisma.unit.findFirst({ where: { id: input.unitId, communityId: input.communityId } });
    if (!unit) throw new NotFoundError('La unidad no pertenece a esta comunidad');
  }

  return prisma.procedure.create({
    data: {
      communityId: input.communityId,
      requesterId: userId,
      type: input.type,
      subject: input.subject,
      description: input.description,
      unitId: input.unitId ?? null,
    },
  });
}

// ─── Mis trámites (vecino) ──────────────────────────────────

export async function listMyProcedures(userId: string) {
  return prisma.procedure.findMany({
    where: { requesterId: userId },
    orderBy: { createdAt: 'desc' },
    include: {
      community: { select: { id: true, name: true } },
      _count: { select: { updates: true } },
    },
  });
}

// ─── Trámites de una comunidad (admin) ──────────────────────

export async function listCommunityProcedures(
  userId: string,
  userRole: UserRole,
  communityId: string,
  filter: ListProceduresQuery
) {
  await assertCommunityAccess(userId, userRole, communityId);

  const where: Prisma.ProcedureWhereInput = { communityId };
  if (filter.status) where.status = filter.status;
  if (filter.type) where.type = filter.type;

  return prisma.procedure.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      requester: { select: { id: true, firstName: true, lastName: true, email: true } },
      unit: { select: { id: true, label: true } },
      _count: { select: { updates: true } },
    },
  });
}

// ─── Detalle ────────────────────────────────────────────────

export async function getProcedure(userId: string, userRole: UserRole, id: string) {
  const procedure = await prisma.procedure.findUnique({
    where: { id },
    include: {
      community: { select: { id: true, name: true } },
      requester: { select: { id: true, firstName: true, lastName: true, email: true } },
      unit: { select: { id: true, label: true } },
      handledBy: { select: { id: true, firstName: true, lastName: true } },
      updates: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, firstName: true, lastName: true, role: true } } },
      },
    },
  });
  if (!procedure) throw new NotFoundError('Trámite no encontrado');

  const isRequester = procedure.requesterId === userId;
  const admin = await isCommunityAdmin(userId, userRole, procedure.communityId);
  if (!isRequester && !admin) throw new ForbiddenError('Sin acceso a este trámite');

  return { ...procedure, canManage: admin };
}

// ─── Actualizar (admin) ─────────────────────────────────────

export async function updateProcedure(userId: string, userRole: UserRole, id: string, input: UpdateProcedureInput) {
  const procedure = await prisma.procedure.findUnique({ where: { id } });
  if (!procedure) throw new NotFoundError('Trámite no encontrado');

  const admin = await isCommunityAdmin(userId, userRole, procedure.communityId);
  if (!admin) throw new ForbiddenError('Solo el administrador puede gestionar el trámite');

  const resolving =
    (input.status === 'COMPLETED' || input.status === 'REJECTED') && !procedure.resolvedAt;

  return prisma.procedure.update({
    where: { id },
    data: {
      status: input.status,
      resolution: input.resolution,
      attachmentUrl: input.attachmentUrl,
      handledById: userId,
      resolvedAt: resolving
        ? new Date()
        : input.status === 'SUBMITTED' || input.status === 'IN_REVIEW' || input.status === 'IN_PROGRESS'
          ? null
          : undefined,
    },
  });
}

// ─── Mensajes del hilo ──────────────────────────────────────

export async function addUpdate(userId: string, userRole: UserRole, id: string, input: AddUpdateInput) {
  const procedure = await prisma.procedure.findUnique({ where: { id } });
  if (!procedure) throw new NotFoundError('Trámite no encontrado');

  const isRequester = procedure.requesterId === userId;
  const admin = await isCommunityAdmin(userId, userRole, procedure.communityId);
  if (!isRequester && !admin) throw new ForbiddenError('Sin acceso a este trámite');

  return prisma.procedureUpdate.create({
    data: { procedureId: id, authorId: userId, body: input.body },
    include: { author: { select: { id: true, firstName: true, lastName: true, role: true } } },
  });
}
