import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { ForbiddenError, NotFoundError, ConflictError } from '../../utils/errors';
import type { CreateAreaInput, UpdateAreaInput, CreateReservationInput } from './common-areas.schemas';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function assertAdminManagesCommunity(adminId: string, communityId: string): Promise<void> {
  const link = await prisma.communityAdmin.findUnique({
    where: { communityId_userId: { communityId, userId: adminId } },
  });
  if (!link) throw new ForbiddenError('No gestionas esta comunidad');
}

async function getAreaOrThrow(areaId: string) {
  const area = await prisma.commonArea.findUnique({ where: { id: areaId } });
  if (!area) throw new NotFoundError('Zona común no encontrada');
  return area;
}

// ─── Areas ──────────────────────────────────────────────────────────────────

export async function listAreas(communityId: string) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const areas = await prisma.commonArea.findMany({
    where: { communityId, active: true },
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          reservations: {
            where: {
              status: 'CONFIRMED',
              startAt: { gte: todayStart, lte: todayEnd },
            },
          },
        },
      },
    },
  });

  return areas.map((area) => ({
    ...area,
    todayConfirmedCount: area._count.reservations,
  }));
}

export async function createArea(adminId: string, communityId: string, input: CreateAreaInput) {
  await assertAdminManagesCommunity(adminId, communityId);

  const area = await prisma.commonArea.create({
    data: {
      communityId,
      name: input.name,
      description: input.description ?? null,
      capacity: input.capacity ?? null,
      openTime: input.openTime ?? '08:00',
      closeTime: input.closeTime ?? '22:00',
      slotMinutes: input.slotMinutes ?? 60,
      maxSlotsPerDay: input.maxSlotsPerDay ?? 2,
    },
  });

  void audit({
    action: 'RESERVATION_CREATED',
    actorId: adminId,
    communityId,
    targetType: 'CommonArea',
    targetId: area.id,
    meta: { name: area.name },
  });

  return area;
}

export async function updateArea(adminId: string, areaId: string, input: UpdateAreaInput) {
  const area = await getAreaOrThrow(areaId);
  await assertAdminManagesCommunity(adminId, area.communityId);

  return prisma.commonArea.update({
    where: { id: areaId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.capacity !== undefined && { capacity: input.capacity }),
      ...(input.openTime !== undefined && { openTime: input.openTime }),
      ...(input.closeTime !== undefined && { closeTime: input.closeTime }),
      ...(input.slotMinutes !== undefined && { slotMinutes: input.slotMinutes }),
      ...(input.maxSlotsPerDay !== undefined && { maxSlotsPerDay: input.maxSlotsPerDay }),
    },
  });
}

export async function deleteArea(adminId: string, areaId: string) {
  const area = await getAreaOrThrow(areaId);
  await assertAdminManagesCommunity(adminId, area.communityId);

  await prisma.commonArea.update({
    where: { id: areaId },
    data: { active: false },
  });
}

// ─── Reservations ────────────────────────────────────────────────────────────

export async function listReservations(areaId: string, date: string) {
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  return prisma.reservation.findMany({
    where: {
      areaId,
      status: 'CONFIRMED',
      startAt: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { startAt: 'asc' },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export async function createReservation(
  userId: string,
  communityId: string,
  input: CreateReservationInput
) {
  // Find and validate area
  const area = await prisma.commonArea.findUnique({ where: { id: input.areaId } });
  if (!area) throw new NotFoundError('Zona común no encontrada');
  if (!area.active) throw new ForbiddenError('La zona común no está activa');
  if (area.communityId !== communityId) throw new ForbiddenError('La zona común no pertenece a esta comunidad');

  // Verify user is an occupant or owner in this community
  const isResident =
    (await prisma.ownership.count({
      where: { ownerId: userId, endDate: null, unit: { communityId } },
    })) > 0 ||
    (await prisma.occupancy.count({
      where: { occupantId: userId, endDate: null, unit: { communityId } },
    })) > 0;
  if (!isResident) throw new ForbiddenError('No perteneces a esta comunidad');

  // Compute slot times
  const startAt = input.startAt instanceof Date ? input.startAt : new Date(input.startAt);
  const endAt = new Date(startAt.getTime() + area.slotMinutes * 60 * 1000);

  // Check for overlapping CONFIRMED reservation
  const overlap = await prisma.reservation.findFirst({
    where: {
      areaId: area.id,
      status: 'CONFIRMED',
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
  });
  if (overlap) throw new ConflictError('Ya existe una reserva en ese horario');

  // Check user hasn't exceeded maxSlotsPerDay
  const dayStart = new Date(startAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(startAt);
  dayEnd.setHours(23, 59, 59, 999);

  const userDayCount = await prisma.reservation.count({
    where: {
      areaId: area.id,
      userId,
      status: 'CONFIRMED',
      startAt: { gte: dayStart, lte: dayEnd },
    },
  });
  if (userDayCount >= area.maxSlotsPerDay) {
    throw new ConflictError(`Has alcanzado el límite de ${area.maxSlotsPerDay} reservas por día en esta zona`);
  }

  const reservation = await prisma.reservation.create({
    data: {
      areaId: area.id,
      userId,
      startAt,
      endAt,
      notes: input.notes ?? null,
    },
  });

  void audit({
    action: 'RESERVATION_CREATED',
    actorId: userId,
    communityId,
    targetType: 'Reservation',
    targetId: reservation.id,
    meta: { areaId: area.id, areaName: area.name, startAt: startAt.toISOString() },
  });

  return reservation;
}

export async function listMyReservations(userId: string) {
  return prisma.reservation.findMany({
    where: {
      userId,
      status: 'CONFIRMED',
    },
    orderBy: { startAt: 'desc' },
    include: {
      area: {
        select: {
          id: true,
          name: true,
          communityId: true,
          community: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function cancelReservation(
  requesterId: string,
  reservationId: string,
  isAdmin: boolean
) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { area: { select: { communityId: true } } },
  });
  if (!reservation) throw new NotFoundError('Reserva no encontrada');
  if (reservation.status === 'CANCELLED') throw new ConflictError('La reserva ya está cancelada');

  if (isAdmin) {
    // Admin must manage the community that owns the area
    await assertAdminManagesCommunity(requesterId, reservation.area.communityId);
  } else {
    // Non-admin can only cancel their own reservations
    if (reservation.userId !== requesterId) {
      throw new ForbiddenError('Solo puedes cancelar tus propias reservas');
    }
  }

  const updated = await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledById: requesterId,
    },
  });

  void audit({
    action: 'RESERVATION_CANCELLED',
    actorId: requesterId,
    communityId: reservation.area.communityId,
    targetType: 'Reservation',
    targetId: reservationId,
  });

  return updated;
}
