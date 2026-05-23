import { prisma } from '../../config/prisma';

export async function listNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function markRead(userId: string, notificationId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function createNotification(userId: string, data: { title: string; body: string; url?: string }) {
  return prisma.notification.create({ data: { userId, ...data } });
}

export async function createNotificationsForCommunity(communityId: string, data: { title: string; body: string; url?: string }) {
  const [members, admins] = await Promise.all([
    prisma.ownership.findMany({
      where: { unit: { communityId }, endDate: null },
      select: { ownerId: true },
      distinct: ['ownerId'],
    }),
    prisma.communityAdmin.findMany({
      where: { communityId },
      select: { userId: true },
    }),
  ]);
  const ids = new Set(members.map(m => m.ownerId));
  for (const a of admins) ids.add(a.userId);
  if (ids.size === 0) return;
  await prisma.notification.createMany({
    data: Array.from(ids).map(userId => ({ userId, ...data })),
    skipDuplicates: true,
  });
}
