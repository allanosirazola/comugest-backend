import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthorizedError } from './errors';

export interface AccessTokenPayload {
  sub: string; // userId
  role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO';
}

export interface RefreshTokenPayload {
  sub: string;
  tokenId: string; // id del registro RefreshToken en BD para poder revocar
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    throw new UnauthorizedError('Token de acceso inválido o expirado');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    throw new UnauthorizedError('Refresh token inválido o expirado');
  }
}

export interface PreAuthTokenPayload {
  sub: string; // userId
  type: 'pre_auth';
}

export function signPreAuthToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'pre_auth' } satisfies PreAuthTokenPayload, env.JWT_ACCESS_SECRET, { expiresIn: '5m' });
}

export function verifyPreAuthToken(token: string): PreAuthTokenPayload {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as PreAuthTokenPayload;
    if (payload.type !== 'pre_auth') throw new Error();
    return payload;
  } catch {
    throw new UnauthorizedError('Token de pre-autenticación inválido o expirado');
  }
}
