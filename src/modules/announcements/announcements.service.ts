import { prisma } from '../../config/prisma';
import type { UserRole } from '@prisma/client';
import { NotFoundError } from '../../utils/errors';
import { assertCommunityAccess } from '../../utils/authz';
import { sendEmail } from '../email/email.service';
import { buildFrontendUrl } from '../email/templates';
import type { CreateAnnouncementInput, UpdateAnnouncementInput } from './announcements.schemas';
import { sendToCommunity } from '../push/push.service';
import { createNotificationsForCommunity } from '../notifications/notifications.service';

export async function listCommunityAnnouncements(userId: string, userRole: UserRole, communityId: string) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.announcement.findMany({
    where: { communityId },
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
    include: { author: { select: { firstName: true, lastName: true } } },
  });
}

export async function createAnnouncement(
  userId: string,
  userRole: UserRole,
  communityId: string,
  input: CreateAnnouncementInput
) {
  await assertCommunityAccess(userId, userRole, communityId);

  const announcement = await prisma.announcement.create({
    data: {
      communityId,
      authorId: userId,
      title: input.title,
      body: input.body,
      pinned: input.pinned,
    },
    include: { author: { select: { firstName: true, lastName: true } } },
  });

  if (input.notify) {
    await notifyResidents(communityId, announcement.title).catch(() => {
      // No bloqueamos la creación si falla el envío
    });
  }

  // Fire-and-forget push notification to community residents
  void sendToCommunity(communityId, {
    title: announcement.title,
    body: announcement.body.slice(0, 100),
    url: `/announcements`,
  });

  // Fire-and-forget in-app notifications
  void createNotificationsForCommunity(communityId, { title: announcement.title, body: announcement.body.slice(0, 120), url: '/announcements' });

  return announcement;
}

async function notifyResidents(communityId: string, title: string): Promise<void> {
  // Destinatarios: ocupantes y propietarios activos de cualquier unidad de la comunidad
  const [occupancies, ownerships, community] = await Promise.all([
    prisma.occupancy.findMany({
      where: { unit: { communityId }, endDate: null },
      include: { occupant: { select: { email: true, firstName: true, locale: true } } },
    }),
    prisma.ownership.findMany({
      where: { unit: { communityId }, endDate: null },
      include: { owner: { select: { email: true, firstName: true, locale: true } } },
    }),
    prisma.community.findUnique({ where: { id: communityId } }),
  ]);
  if (!community) return;

  // Deduplicar por email
  const recipients = new Map<string, { email: string; firstName: string; locale: string }>();
  occupancies.forEach((o) => recipients.set(o.occupant.email, o.occupant));
  ownerships.forEach((o) => recipients.set(o.owner.email, o.owner));

  for (const r of recipients.values()) {
    await sendEmail({
      to: r.email,
      template: 'announcementPublished',
      locale: (r.locale as 'es' | 'en') ?? 'es',
      vars: {
        firstName: r.firstName,
        communityName: community.name,
        title,
        viewUrl: buildFrontendUrl('/announcements'),
      },
    });
  }
}

export async function updateAnnouncement(
  userId: string,
  userRole: UserRole,
  id: string,
  input: UpdateAnnouncementInput
) {
  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Anuncio no encontrado');
  await assertCommunityAccess(userId, userRole, existing.communityId);
  return prisma.announcement.update({ where: { id }, data: input });
}

export async function deleteAnnouncement(userId: string, userRole: UserRole, id: string) {
  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Anuncio no encontrado');
  await assertCommunityAccess(userId, userRole, existing.communityId);
  await prisma.announcement.delete({ where: { id } });
}

/**
 * Anuncios visibles para un vecino: los de todas las comunidades donde
 * es propietario u ocupante activo.
 */
export async function listMyAnnouncements(userId: string) {
  const [ownerships, occupancies] = await Promise.all([
    prisma.ownership.findMany({ where: { ownerId: userId, endDate: null }, include: { unit: { select: { communityId: true } } } }),
    prisma.occupancy.findMany({ where: { occupantId: userId, endDate: null }, include: { unit: { select: { communityId: true } } } }),
  ]);
  const communityIds = Array.from(
    new Set([...ownerships.map((o) => o.unit.communityId), ...occupancies.map((o) => o.unit.communityId)])
  );
  if (communityIds.length === 0) return [];

  return prisma.announcement.findMany({
    where: { communityId: { in: communityIds } },
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
    include: {
      author: { select: { firstName: true, lastName: true } },
      community: { select: { id: true, name: true } },
    },
  });
}
