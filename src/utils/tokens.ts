import crypto from 'crypto';

/**
 * Genera un token aleatorio criptográficamente seguro y lo devuelve junto a su hash.
 * Guardamos el hash en BD; nunca el token en claro.
 */
export function generateVerificationToken(): { token: string; tokenHash: string } {
  // 32 bytes en base64url ≈ 43 chars sin padding, fácil de poner en URL
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  return { token, tokenHash };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Comparación en tiempo constante para evitar timing attacks
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
