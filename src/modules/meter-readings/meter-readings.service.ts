import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { assertCommunityAccess } from '../../utils/authz';
import type { UserRole } from '@prisma/client';
import type { CreateMeterReadingInput } from './meter-readings.schemas';

const readingSelect = {
  id: true,
  type: true,
  readingDate: true,
  value: true,
  consumption: true,
  notes: true,
  createdAt: true,
  unit: { select: { id: true, label: true, type: true } },
  recordedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export async function listReadings(communityId: string, unitId?: string, type?: string) {
  return prisma.meterReading.findMany({
    where: {
      unit: { communityId },
      ...(unitId && { unitId }),
      ...(type && { type: type as any }),
    },
    select: readingSelect,
    orderBy: [{ unitId: 'asc' }, { type: 'asc' }, { readingDate: 'desc' }],
  });
}

export async function createReading(
  actorId: string,
  actorRole: UserRole,
  communityId: string,
  input: CreateMeterReadingInput,
) {
  await assertCommunityAccess(actorId, actorRole, communityId);

  // Verify unit belongs to community
  const unit = await prisma.unit.findFirst({
    where: { id: input.unitId, communityId },
    select: { id: true },
  });
  if (!unit) throw new Error('Unit not found in this community');

  // Find previous reading to compute consumption
  const prev = await prisma.meterReading.findFirst({
    where: { unitId: input.unitId, type: input.type as any },
    orderBy: { readingDate: 'desc' },
    select: { value: true },
  });

  const consumption = prev ? Number(input.value) - Number(prev.value) : null;

  const reading = await prisma.meterReading.create({
    data: {
      unitId: input.unitId,
      type: input.type as any,
      readingDate: new Date(input.readingDate),
      value: input.value,
      consumption: consumption !== null ? consumption : undefined,
      notes: input.notes,
      recordedById: actorId,
    },
    select: readingSelect,
  });

  void audit({
    action: 'METER_READING_ADDED',
    actorId,
    communityId,
    meta: { unitId: input.unitId, type: input.type, value: input.value },
  });

  return reading;
}

export async function deleteReading(
  actorId: string,
  actorRole: UserRole,
  readingId: string,
) {
  const reading = await prisma.meterReading.findUnique({
    where: { id: readingId },
    include: { unit: { select: { communityId: true } } },
  });
  if (!reading) throw new Error('Reading not found');
  await assertCommunityAccess(actorId, actorRole, reading.unit.communityId);
  await prisma.meterReading.delete({ where: { id: readingId } });
}
