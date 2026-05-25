import { prisma } from '../../config/prisma';

export async function joinWaitlist(userId: string, areaId: string, startTime: Date, endTime: Date) {
  return prisma.reservationWaitlist.upsert({
    where: { areaId_userId_startTime_endTime: { areaId, userId, startTime, endTime } },
    create: { areaId, userId, startTime, endTime },
    update: {},
  });
}

export async function leaveWaitlist(userId: string, entryId: string) {
  await prisma.reservationWaitlist.deleteMany({ where: { id: entryId, userId } });
}

export async function listMyWaitlist(userId: string) {
  return prisma.reservationWaitlist.findMany({
    where: { userId },
    include: { area: { select: { name: true, communityId: true } } },
    orderBy: { startTime: 'asc' },
  });
}

export async function listAreaWaitlist(areaId: string) {
  return prisma.reservationWaitlist.findMany({
    where: { areaId },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
}
