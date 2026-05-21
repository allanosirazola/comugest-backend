import { prisma } from '../../config/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { assertCommunityAccess, getManagedCommunityIds } from '../../utils/authz';
import type { CreateCommunityInput, UpdateCommunityInput } from './communities.schemas';
import type { UserRole } from '@prisma/client';

const COEFFICIENT_TOLERANCE = 0.01; // permitimos redondeos mínimos

/**
 * Crea comunidad. Si vienen unidades en el payload, las inserta en la misma
 * transacción y vincula al admin que la crea.
 */
export async function createCommunity(userId: string, input: CreateCommunityInput) {
  // Si trae unidades, validar suma de coeficientes
  if (input.units.length > 0) {
    const totalCoef = input.units.reduce((acc, u) => acc + u.coefficient, 0);
    if (totalCoef > 100 + COEFFICIENT_TOLERANCE) {
      throw new ValidationError(
        `La suma de coeficientes (${totalCoef.toFixed(2)}) supera 100. Revisa los porcentajes.`
      );
    }
    // Etiquetas únicas
    const labels = input.units.map((u) => u.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      throw new ValidationError('Hay etiquetas de unidades duplicadas');
    }
  }

  return prisma.$transaction(async (tx) => {
    const community = await tx.community.create({
      data: {
        name: input.name,
        address: input.address,
        city: input.city,
        postalCode: input.postalCode,
        country: input.country,
        cif: input.cif ?? null,
        admins: { create: { userId } },
        units:
          input.units.length > 0
            ? {
                create: input.units.map((u) => ({
                  type: u.type,
                  label: u.label,
                  floor: u.floor ?? null,
                  door: u.door ?? null,
                  coefficient: u.coefficient,
                  surfaceM2: u.surfaceM2 ?? null,
                })),
              }
            : undefined,
      },
      include: {
        _count: { select: { units: true } },
      },
    });
    return community;
  });
}

/**
 * Lista comunidades que el usuario puede gestionar.
 */
export async function listCommunities(userId: string, userRole: UserRole) {
  const where =
    userRole === 'SUPPORT'
      ? {}
      : { id: { in: await getManagedCommunityIds(userId) } };

  return prisma.community.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { _count: { select: { units: true } } },
  });
}

/**
 * Detalle de comunidad con unidades y resumen.
 */
export async function getCommunity(userId: string, userRole: UserRole, id: string) {
  await assertCommunityAccess(userId, userRole, id);

  const community = await prisma.community.findUnique({
    where: { id },
    include: {
      units: {
        orderBy: [{ type: 'asc' }, { label: 'asc' }],
        include: {
          ownerships: {
            where: { endDate: null },
            include: {
              owner: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
            },
          },
          occupancies: {
            where: { endDate: null },
            include: {
              occupant: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
            },
          },
        },
      },
      admins: {
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      },
    },
  });

  if (!community) throw new NotFoundError('Comunidad no encontrada');
  return community;
}

export async function updateCommunity(
  userId: string,
  userRole: UserRole,
  id: string,
  input: UpdateCommunityInput
) {
  await assertCommunityAccess(userId, userRole, id);
  return prisma.community.update({
    where: { id },
    data: input,
  });
}

export async function deleteCommunity(userId: string, userRole: UserRole, id: string) {
  await assertCommunityAccess(userId, userRole, id);

  // No permitimos borrar si tiene unidades con ocupantes activos para evitar pérdida accidental
  const activeOccupants = await prisma.occupancy.count({
    where: { unit: { communityId: id }, endDate: null },
  });
  if (activeOccupants > 0) {
    throw new ConflictError(
      `Esta comunidad tiene ${activeOccupants} ocupaciones activas. Da de baja a los ocupantes antes de eliminar.`
    );
  }

  await prisma.community.delete({ where: { id } });
}

/**
 * Comunidades a las que pertenece un vecino (propietario u ocupante activo).
 * Accesible por cualquier usuario autenticado para sus propias comunidades.
 */
export async function listMyCommunities(userId: string) {
  const [ownerships, occupancies] = await Promise.all([
    prisma.ownership.findMany({ where: { ownerId: userId, endDate: null }, select: { unit: { select: { communityId: true } } } }),
    prisma.occupancy.findMany({ where: { occupantId: userId, endDate: null }, select: { unit: { select: { communityId: true } } } }),
  ]);
  const ids = Array.from(
    new Set([...ownerships.map((o) => o.unit.communityId), ...occupancies.map((o) => o.unit.communityId)])
  );
  if (ids.length === 0) return [];
  return prisma.community.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, city: true },
    orderBy: { name: 'asc' },
  });
}
