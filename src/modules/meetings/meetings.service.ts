import crypto from 'crypto';
import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError, UnauthorizedError } from '../../utils/errors';
import { assertCommunityAccess } from '../../utils/authz';
import type { UserRole } from '@prisma/client';
import type { CreateMeetingInput, UpdateMeetingInput, UpdateAttendanceInput } from './meetings.schemas';
import type { Meeting } from '@prisma/client';
import { verifySync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';

const totpPlugins = {
  crypto: new NobleCryptoPlugin(),
  encoding: new ScureBase32Plugin(),
};

export async function listMeetings(communityId: string) {
  return prisma.meeting.findMany({
    where: { communityId },
    orderBy: { scheduledAt: 'desc' },
    include: {
      _count: {
        select: {
          attendees: true,
        },
      },
    },
  });
}

export async function getMeeting(meetingId: string, _requesterId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      attendees: {
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });
  if (!meeting) throw new NotFoundError('Reunión no encontrada');
  return meeting;
}

export async function createMeeting(
  adminId: string,
  communityId: string,
  input: CreateMeetingInput
) {
  // Verify adminId manages communityId
  const link = await prisma.communityAdmin.findUnique({
    where: { communityId_userId: { communityId, userId: adminId } },
  });
  if (!link) throw new ForbiddenError('No gestionas esta comunidad');

  const meeting = await prisma.meeting.create({
    data: {
      communityId,
      organizedById: adminId,
      title: input.title,
      type: input.type,
      scheduledAt: input.scheduledAt,
      location: input.location ?? null,
      agenda: input.agenda ?? null,
    },
  });

  // Bulk-create attendee rows for all active occupants/owners of this community
  const occupancies = await prisma.occupancy.findMany({
    where: { unit: { communityId }, endDate: null },
    select: { occupantId: true },
    distinct: ['occupantId'],
  });

  const attendeeData = occupancies.map((o) => ({
    meetingId: meeting.id,
    userId: o.occupantId,
    status: 'PENDING' as const,
  }));

  if (attendeeData.length > 0) {
    await prisma.meetingAttendee.createMany({ data: attendeeData, skipDuplicates: true });
  }

  void audit({
    action: 'MEETING_CREATED',
    actorId: adminId,
    targetType: 'Meeting',
    targetId: meeting.id,
    communityId,
    meta: { title: meeting.title, type: meeting.type },
  });

  return meeting;
}

export async function updateMeeting(
  adminId: string,
  meetingId: string,
  input: UpdateMeetingInput
) {
  const existing = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!existing) throw new NotFoundError('Reunión no encontrada');

  // Verify adminId manages the meeting's community
  const link = await prisma.communityAdmin.findUnique({
    where: { communityId_userId: { communityId: existing.communityId, userId: adminId } },
  });
  if (!link) throw new ForbiddenError('No gestionas esta comunidad');

  const meeting = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt }),
      ...(input.location !== undefined && { location: input.location }),
      ...(input.agenda !== undefined && { agenda: input.agenda }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.minutes !== undefined && { minutes: input.minutes }),
      ...(input.minutesUrl !== undefined && { minutesUrl: input.minutesUrl }),
    },
  });

  void audit({
    action: 'MEETING_UPDATED',
    actorId: adminId,
    targetType: 'Meeting',
    targetId: meeting.id,
    communityId: existing.communityId,
    meta: { updatedFields: Object.keys(input) },
  });

  return meeting;
}

export async function listMyMeetings(userId: string) {
  return prisma.meeting.findMany({
    where: {
      attendees: { some: { userId } },
    },
    orderBy: { scheduledAt: 'desc' },
    include: {
      attendees: {
        where: { userId },
        select: { status: true },
      },
    },
  });
}

export async function updateAttendance(
  userId: string,
  meetingId: string,
  input: UpdateAttendanceInput
) {
  const attendee = await prisma.meetingAttendee.findUnique({
    where: { meetingId_userId: { meetingId, userId } },
  });
  if (!attendee) throw new NotFoundError('No estás registrado como asistente de esta reunión');

  if (input.status === 'DELEGATED' && (!input.proxy || input.proxy.trim().length === 0)) {
    throw new ValidationError('proxy es obligatorio cuando el estado es DELEGATED');
  }

  return prisma.meetingAttendee.update({
    where: { meetingId_userId: { meetingId, userId } },
    data: {
      status: input.status,
      proxy: input.proxy ?? null,
    },
  });
}

export async function saveMinutes(
  actorId: string,
  actorRole: UserRole,
  meetingId: string,
  minutes: string,
) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, communityId: true },
  });
  if (!meeting) throw new NotFoundError('Meeting not found');
  await assertCommunityAccess(actorId, actorRole, meeting.communityId);

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: { minutes, minutesUpdatedAt: new Date() },
    select: { id: true, title: true, minutes: true, minutesUpdatedAt: true, minutesPublished: true },
  });

  void audit({ action: 'MINUTES_SAVED', actorId, communityId: meeting.communityId, meta: { meetingId } });
  return updated;
}

export async function publishMinutes(
  actorId: string,
  actorRole: UserRole,
  meetingId: string,
  published: boolean,
) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, communityId: true },
  });
  if (!meeting) throw new NotFoundError('Meeting not found');
  await assertCommunityAccess(actorId, actorRole, meeting.communityId);

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: { minutesPublished: published },
    select: { id: true, title: true, minutes: true, minutesUpdatedAt: true, minutesPublished: true },
  });

  void audit({ action: 'MINUTES_PUBLISHED', actorId, communityId: meeting.communityId, meta: { meetingId, published } });
  return updated;
}

export async function signMinutes(actorId: string, actorRole: UserRole, meetingId: string, totpCode: string): Promise<Meeting> {
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: { community: true },
  });
  await assertCommunityAccess(actorId, actorRole, meeting.communityId);

  if (!meeting.minutes) throw new ValidationError('No hay acta redactada para firmar');
  if (meeting.minutesSignedAt) throw new ValidationError('El acta ya está firmada');

  // Verify TOTP
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actorId },
    select: { totpSecret: true, totpEnabled: true },
  });
  if (!user.totpEnabled || !user.totpSecret) {
    throw new ValidationError('Debes tener 2FA activado para firmar el acta');
  }
  const result = verifySync({ ...totpPlugins, secret: user.totpSecret, token: totpCode, strategy: 'totp' });
  if (!result.valid) throw new UnauthorizedError('Código 2FA incorrecto');

  const now = new Date();
  const payload = `${meeting.minutes}|${actorId}|${now.toISOString()}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex');

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      minutesSignedAt: now,
      minutesSignedById: actorId,
      minutesSignatureHash: hash,
    },
    include: { minutesSignedBy: { select: { firstName: true, lastName: true, email: true } } },
  });

  void audit({ actorId, communityId: meeting.communityId, action: 'MINUTES_PUBLISHED', targetId: meetingId, meta: { signed: true, hash: hash.slice(0, 16) } });
  return updated;
}

// ─── In-memory QR token store (resets on restart, fine for meeting use) ──────

const qrTokens = new Map<string, { meetingId: string; expiresAt: number }>();

export async function generateQrToken(
  actorId: string,
  actorRole: UserRole,
  meetingId: string,
): Promise<{ token: string; url: string }> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { communityId: true },
  });
  if (!meeting) throw new NotFoundError('Reunión no encontrada');
  await assertCommunityAccess(actorId, actorRole, meeting.communityId);

  const token = crypto.randomBytes(24).toString('hex');
  qrTokens.set(token, { meetingId, expiresAt: Date.now() + 4 * 60 * 60 * 1000 });
  return { token, url: `/meetings/qr-check-in/${token}` };
}

export async function checkInWithQr(token: string, userId: string): Promise<void> {
  const entry = qrTokens.get(token);
  if (!entry || Date.now() > entry.expiresAt) throw new ValidationError('QR inválido o expirado');
  qrTokens.delete(token);

  // Mark attendance as CONFIRMED
  const existing = await prisma.meetingAttendee.findFirst({
    where: { meetingId: entry.meetingId, userId },
  });
  if (existing) {
    await prisma.meetingAttendee.update({
      where: { id: existing.id },
      data: { status: 'CONFIRMED' },
    });
  } else {
    await prisma.meetingAttendee.create({
      data: { meetingId: entry.meetingId, userId, status: 'CONFIRMED' },
    });
  }
}
