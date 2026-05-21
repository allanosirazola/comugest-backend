import { prisma } from '../config/prisma';
import { ForbiddenError } from './errors';
import type { UserRole } from '@prisma/client';

/**
 * Verifica que el usuario tiene acceso administrativo a una comunidad.
 * - SUPPORT: acceso total
 * - ADMIN_FINCAS: solo si está en CommunityAdmin
 * - resto: denegado
 */
export async function assertCommunityAccess(
  userId: string,
  userRole: UserRole,
  communityId: string
): Promise<void> {
  if (userRole === 'SUPPORT') return;
  if (userRole !== 'ADMIN_FINCAS') {
    throw new ForbiddenError('Sin permisos sobre esta comunidad');
  }
  const link = await prisma.communityAdmin.findUnique({
    where: { communityId_userId: { communityId, userId } },
  });
  if (!link) throw new ForbiddenError('No gestionas esta comunidad');
}

/**
 * Devuelve los IDs de las comunidades que un admin gestiona.
 * SUPPORT recibe array vacío con flag — la lógica de "ver todo" se aplica caller-side.
 */
export async function getManagedCommunityIds(userId: string): Promise<string[]> {
  const links = await prisma.communityAdmin.findMany({
    where: { userId },
    select: { communityId: true },
  });
  return links.map((l) => l.communityId);
}
