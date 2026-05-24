import { prisma } from '../../config/prisma';
import type { UserRole } from '@prisma/client';
import { assertCommunityAccess } from '../../utils/authz';

export async function listIncidents(userId: string, userRole: UserRole, communityId: string) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.incidentLog.findMany({
    where: { communityId },
    include: { reportedBy: { select: { firstName: true, lastName: true } } },
    orderBy: { number: 'desc' },
  });
}

export async function createIncident(
  userId: string,
  userRole: UserRole,
  communityId: string,
  input: { title: string; description: string; category?: string }
) {
  await assertCommunityAccess(userId, userRole, communityId);
  // Get next correlative number
  const last = await prisma.incidentLog.findFirst({
    where: { communityId },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const number = (last?.number ?? 0) + 1;
  return prisma.incidentLog.create({
    data: {
      communityId,
      number,
      reportedById: userId,
      title: input.title,
      description: input.description,
      category: input.category ?? 'GENERAL',
    },
    include: { reportedBy: { select: { firstName: true, lastName: true } } },
  });
}

export async function updateIncidentStatus(
  userId: string,
  userRole: UserRole,
  communityId: string,
  incidentId: string,
  input: { status: string; resolution?: string }
) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.incidentLog.update({
    where: { id: incidentId, communityId },
    data: {
      status: input.status,
      resolution: input.resolution,
      resolvedAt:
        input.status === 'RESOLVED' || input.status === 'CLOSED' ? new Date() : undefined,
    },
  });
}
