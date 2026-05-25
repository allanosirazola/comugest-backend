import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { hashPassword, verifyPassword } from '../../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken, signPreAuthToken, verifyPreAuthToken } from '../../utils/jwt';
import { generateVerificationToken, hashToken } from '../../utils/tokens';
import { ConflictError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { sendEmail } from '../email/email.service';
import { buildFrontendUrl } from '../email/templates';
import type { RegisterInput, LoginInput } from './auth.schemas';
import type { User, UserRole } from '@prisma/client';
import crypto from 'crypto';
import { generateSecret, generateURI, verifySync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import QRCode from 'qrcode';

const totpPlugins = {
  crypto: new NobleCryptoPlugin(),
  encoding: new ScureBase32Plugin(),
};

const CURRENT_GDPR_VERSION = '2025-01-01';

// ─── Tipos públicos ─────────────────────────────────────────

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  locale: string;
  status: User['status'];
}

function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    locale: u.locale,
    status: u.status,
  };
}

// ─── Helpers ────────────────────────────────────────────────

function refreshExpiryDate(): Date {
  const m = env.JWT_REFRESH_EXPIRES_IN.match(/^(\d+)([dhms])$/);
  if (!m) return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const value = parseInt(m[1], 10);
  const unitMs = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 }[m[2]] ?? 86_400_000;
  return new Date(Date.now() + value * unitMs);
}

async function issueTokens(user: User): Promise<AuthResponse> {
  const tokenId = crypto.randomUUID();
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id, tokenId });

  await prisma.refreshToken.create({
    data: {
      id: tokenId,
      token: refreshToken,
      userId: user.id,
      expiresAt: refreshExpiryDate(),
    },
  });

  return { accessToken, refreshToken, user: toPublicUser(user) };
}

async function createAndSendVerificationEmail(user: User): Promise<void> {
  const { token, tokenHash } = generateVerificationToken();
  const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_EXPIRES_HOURS * 60 * 60 * 1000);

  await prisma.verificationToken.create({
    data: {
      tokenHash,
      type: 'EMAIL_VERIFICATION',
      userId: user.id,
      expiresAt,
    },
  });

  await sendEmail({
    to: user.email,
    template: 'emailVerification',
    locale: user.locale as 'es' | 'en',
    vars: {
      firstName: user.firstName,
      verificationUrl: buildFrontendUrl(`/verify-email?token=${encodeURIComponent(token)}`),
      expiresInHours: env.EMAIL_VERIFICATION_EXPIRES_HOURS,
    },
  });
}

// ─── API ────────────────────────────────────────────────────

/**
 * Registro de auto-servicio (vecino o administrador).
 * Crea usuario en estado PENDING y envía email de verificación.
 * No emite tokens hasta que el email esté verificado.
 */
export async function register(input: RegisterInput): Promise<{ requiresEmailVerification: true; email: string }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });

  if (existing && existing.status !== 'INVITED') {
    throw new ConflictError('Ya existe un usuario con ese email');
  }

  const passwordHash = await hashPassword(input.password);

  // Si existía como INVITED, lo "promocionamos" en lugar de crear duplicado.
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          role: input.role,
          locale: input.locale,
          status: 'PENDING',
          gdprAcceptedAt: new Date(),
          gdprVersion: CURRENT_GDPR_VERSION,
        },
      })
    : await prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          role: input.role,
          locale: input.locale,
          status: 'PENDING',
          gdprAcceptedAt: new Date(),
          gdprVersion: CURRENT_GDPR_VERSION,
        },
      });

  await createAndSendVerificationEmail(user);

  return { requiresEmailVerification: true, email: user.email };
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.passwordHash) {
    throw new UnauthorizedError('Credenciales inválidas');
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw new UnauthorizedError('Credenciales inválidas');

  if (user.status === 'DISABLED') {
    throw new UnauthorizedError('Usuario desactivado');
  }
  if (user.status === 'PENDING') {
    // No filtramos credenciales aquí: el usuario ya pasó la contraseña.
    // Devolvemos 403 con código específico que el frontend puede traducir.
    throw new ForbiddenError('Debes verificar tu email antes de iniciar sesión');
  }
  if (user.status === 'INVITED') {
    throw new ForbiddenError('Tu cuenta aún no ha sido activada. Revisa tu email de invitación');
  }

  if (user.totpEnabled) {
    const preAuthToken = signPreAuthToken(user.id);
    return { requiresTwoFactor: true, preAuthToken } as unknown as AuthResponse;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return issueTokens(user);
}

export async function completeTwoFactorLogin(preAuthToken: string, totpCode: string): Promise<AuthResponse> {
  const payload = verifyPreAuthToken(preAuthToken);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: payload.sub },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, totpSecret: true, totpEnabled: true, status: true, locale: true },
  });
  if (!user.totpEnabled || !user.totpSecret) throw new UnauthorizedError('2FA no está activado');
  const result = verifySync({ ...totpPlugins, secret: user.totpSecret, token: totpCode, strategy: 'totp' });
  if (!result.valid) throw new UnauthorizedError('Código 2FA incorrecto');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return issueTokens(user as Parameters<typeof issueTokens>[0]);
}

export async function verifyEmail(rawToken: string): Promise<AuthResponse> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.type !== 'EMAIL_VERIFICATION') {
    throw new NotFoundError('Token de verificación no válido');
  }
  if (record.usedAt) {
    throw new ValidationError('Este enlace ya ha sido utilizado');
  }
  if (record.expiresAt < new Date()) {
    throw new ValidationError('Este enlace ha caducado. Solicita uno nuevo');
  }

  // Marcamos token como usado y activamos al usuario en una transacción
  const user = await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return tx.user.update({
      where: { id: record.userId },
      data: {
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
  });

  return issueTokens(user);
}

export async function resendVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Respondemos OK silencioso aunque el email no exista, para no filtrar emails registrados
  if (!user || user.status !== 'PENDING') return;

  // Invalidar tokens anteriores no usados del mismo tipo
  await prisma.verificationToken.updateMany({
    where: { userId: user.id, type: 'EMAIL_VERIFICATION', usedAt: null },
    data: { usedAt: new Date() },
  });

  await createAndSendVerificationEmail(user);
}

export async function refresh(refreshToken: string): Promise<AuthResponse> {
  const payload = verifyRefreshToken(refreshToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { id: payload.tokenId },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.token !== refreshToken) {
    throw new UnauthorizedError('Refresh token no válido');
  }
  if (stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expirado');
  }
  if (stored.user.status !== 'ACTIVE') {
    throw new UnauthorizedError('Usuario no activo');
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return issueTokens(stored.user);
}

export async function logout(refreshToken: string): Promise<void> {
  try {
    const payload = verifyRefreshToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: { id: payload.tokenId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    // logout idempotente
  }
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError();
  return toPublicUser(user);
}

/**
 * Solicita restablecer contraseña. Responde igual exista o no el email
 * (no filtra cuentas registradas).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status === 'DISABLED' || !user.passwordHash) return;

  // Invalida tokens de reset anteriores no usados
  await prisma.verificationToken.updateMany({
    where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null },
    data: { usedAt: new Date() },
  });

  const { token, tokenHash } = generateVerificationToken();
  const expiresHours = 2;
  await prisma.verificationToken.create({
    data: {
      tokenHash,
      type: 'PASSWORD_RESET',
      userId: user.id,
      expiresAt: new Date(Date.now() + expiresHours * 60 * 60 * 1000),
    },
  });

  await sendEmail({
    to: user.email,
    template: 'passwordReset',
    locale: user.locale as 'es' | 'en',
    vars: {
      firstName: user.firstName,
      resetUrl: buildFrontendUrl(`/reset-password?token=${encodeURIComponent(token)}`),
      expiresInHours: expiresHours,
    },
  });
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash } });

  if (!record || record.type !== 'PASSWORD_RESET') {
    throw new NotFoundError('Token de recuperación no válido');
  }
  if (record.usedAt) throw new ValidationError('Este enlace ya ha sido utilizado');
  if (record.expiresAt < new Date()) throw new ValidationError('Este enlace ha caducado. Solicita uno nuevo');

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    // Por seguridad, revocamos todas las sesiones activas tras un reset
    await tx.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}

export async function setup2FA(userId: string) {
  const secret = generateSecret(totpPlugins);
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: secret, totpEnabled: false } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  const otpauth = generateURI({ ...totpPlugins, label: user.email, issuer: 'Comugest', secret, strategy: 'totp' });
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  return { secret, qrDataUrl };
}

export async function verify2FA(userId: string, token: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpSecret: true } });
  if (!user.totpSecret) throw new Error('2FA not set up');
  const result = verifySync({ ...totpPlugins, secret: user.totpSecret, token, strategy: 'totp' });
  if (!result.valid) throw new Error('Invalid code');
  await prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
  return { enabled: true };
}

export async function disable2FA(userId: string, token: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpSecret: true, totpEnabled: true } });
  if (!user.totpSecret || !user.totpEnabled) throw new Error('2FA is not enabled');
  const result = verifySync({ ...totpPlugins, secret: user.totpSecret, token, strategy: 'totp' });
  if (!result.valid) throw new Error('Invalid code');
  await prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecret: null } });
}

export async function check2FARequired(userId: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabled: true } });
  return user.totpEnabled;
}
