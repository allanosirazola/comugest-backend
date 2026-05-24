import { prisma } from '../../config/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { assertCommunityAccess } from '../../utils/authz';
import type { CreateUnitInput, UpdateUnitInput } from './units.schemas';
import type { UserRole } from '@prisma/client';

async function getUnitOrThrow(unitId: string) {
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) throw new NotFoundError('Unidad no encontrada');
  return unit;
}

export async function listUnits(userId: string, userRole: UserRole, communityId: string) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.unit.findMany({
    where: { communityId },
    orderBy: [{ type: 'asc' }, { label: 'asc' }],
    include: {
      ownerships: { where: { endDate: null }, select: { ownerId: true } },
      occupancies: { where: { endDate: null }, select: { occupantId: true } },
    },
  });
}

export async function createUnit(
  userId: string,
  userRole: UserRole,
  communityId: string,
  input: CreateUnitInput
) {
  await assertCommunityAccess(userId, userRole, communityId);

  // Comprobamos suma de coeficientes con el resto
  const existing = await prisma.unit.aggregate({
    where: { communityId },
    _sum: { coefficient: true },
  });
  const currentSum = Number(existing._sum.coefficient ?? 0);
  if (currentSum + input.coefficient > 100.01) {
    throw new ValidationError(
      `La suma de coeficientes excedería 100 (actual ${currentSum.toFixed(2)} + ${input.coefficient}).`
    );
  }

  return prisma.unit.create({
    data: {
      communityId,
      type: input.type,
      label: input.label,
      floor: input.floor ?? null,
      door: input.door ?? null,
      coefficient: input.coefficient,
      surfaceM2: input.surfaceM2 ?? null,
      customFields: input.customFields as object,
    },
  });
}

export async function updateUnit(
  userId: string,
  userRole: UserRole,
  unitId: string,
  input: UpdateUnitInput
) {
  const unit = await getUnitOrThrow(unitId);
  await assertCommunityAccess(userId, userRole, unit.communityId);

  // Si cambia el coeficiente, comprobar suma global
  if (input.coefficient !== undefined && Number(unit.coefficient) !== input.coefficient) {
    const others = await prisma.unit.aggregate({
      where: { communityId: unit.communityId, id: { not: unitId } },
      _sum: { coefficient: true },
    });
    const total = Number(others._sum.coefficient ?? 0) + input.coefficient;
    if (total > 100.01) {
      throw new ValidationError(`La suma de coeficientes excedería 100 (resultado: ${total.toFixed(2)}).`);
    }
  }

  return prisma.unit.update({
    where: { id: unitId },
    data: {
      ...input,
      customFields: input.customFields !== undefined ? (input.customFields as object) : undefined,
    },
  });
}

export async function getOwnershipHistory(actorId: string, actorRole: UserRole, communityId: string, unitId: string) {
  await assertCommunityAccess(actorId, actorRole, communityId);
  const unit = await prisma.unit.findUniqueOrThrow({
    where: { id: unitId, communityId },
    include: {
      ownerships: {
        include: {
          owner: { select: { firstName: true, lastName: true, email: true, role: true } },
        },
        orderBy: { startDate: 'desc' },
      },
    },
  });
  return unit.ownerships;
}

export async function deleteUnit(userId: string, userRole: UserRole, unitId: string) {
  const unit = await getUnitOrThrow(unitId);
  await assertCommunityAccess(userId, userRole, unit.communityId);

  // No permitimos borrar si hay relaciones activas
  const activeRelations = await prisma.occupancy.count({
    where: { unitId, endDate: null },
  });
  if (activeRelations > 0) {
    throw new ConflictError('No se puede eliminar una unidad con ocupantes activos');
  }

  await prisma.unit.delete({ where: { id: unitId } });
}
