import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { assertCommunityAccess } from '../../utils/authz';
import type { UserRole } from '@prisma/client';
import type { CreateMeetingInput, UpdateMeetingInput, UpdateAttendanceInput } from './meetings.schemas';

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
