import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { assertCommunityAccess } from '../../utils/authz';
import { ConflictError, NotFoundError } from '../../utils/errors';
import type { UserRole } from '@prisma/client';
import type { AddCoAdminInput } from './co-admins.schemas';

export async function listCoAdmins(communityId: string) {
  return prisma.communityAdmin.findMany({
    where: { communityId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: { assignedAt: 'asc' },
  });
}

export async function addCoAdmin(
  actorId: string,
  actorRole: UserRole,
  communityId: string,
  input: AddCoAdminInput,
) {
  await assertCommunityAccess(actorId, actorRole, communityId);

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!user) throw new NotFoundError('No user found with that email');

  const existing = await prisma.communityAdmin.findUnique({
    where: { communityId_userId: { communityId, userId: user.id } },
  });
  if (existing) throw new ConflictError('User is already an admin of this community');

  await prisma.communityAdmin.create({ data: { communityId, userId: user.id } });

  void audit({
    action: 'CO_ADMIN_ADDED',
    actorId,
    communityId,
    meta: { targetUserId: user.id, email: user.email },
  });

  return user;
}

export async function removeCoAdmin(
  actorId: string,
  actorRole: UserRole,
  communityId: string,
  userId: string,
) {
  await assertCommunityAccess(actorId, actorRole, communityId);

  if (actorId === userId) {
    throw new ConflictError('Cannot remove yourself as admin');
  }

  const existing = await prisma.communityAdmin.findUnique({
    where: { communityId_userId: { communityId, userId } },
  });
  if (!existing) throw new NotFoundError('Admin not found');

  await prisma.communityAdmin.delete({
    where: { communityId_userId: { communityId, userId } },
  });

  void audit({
    action: 'CO_ADMIN_REMOVED',
    actorId,
    communityId,
    meta: { targetUserId: userId },
  });
}
