import { prisma } from '../src/config/prisma';
import { signAccessToken } from '../src/utils/jwt';
import type { UserRole } from '@prisma/client';

let counter = 0;

/**
 * Sufijo único por proceso para evitar colisiones de email entre tests
 * que corren en la misma BD.
 */
function uniq(prefix = ''): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface TestUser {
  id: string;
  email: string;
  role: UserRole;
  token: string;
}

/**
 * Crea un usuario ACTIVE+verificado y firma un access token.
 * Evita el flujo completo de registro/verificación: en tests no
 * necesitamos probar bcrypt ni email — solo authz.
 */
export async function createUser(overrides: Partial<{
  role: UserRole;
  firstName: string;
  lastName: string;
  email: string;
}> = {}): Promise<TestUser> {
  const email = overrides.email ?? `user-${uniq()}@test.example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      firstName: overrides.firstName ?? 'Test',
      lastName: overrides.lastName ?? 'User',
      role: overrides.role ?? 'VECINO',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      gdprAcceptedAt: new Date(),
      gdprVersion: '2025-01-01',
    },
  });
  const token = signAccessToken({ sub: user.id, role: user.role });
  return { id: user.id, email: user.email, role: user.role, token };
}

/**
 * Crea una comunidad mínima y, opcionalmente, vincula a un admin.
 */
export async function createCommunity(overrides: Partial<{
  name: string;
  adminId: string;
}> = {}): Promise<{ id: string; name: string }> {
  const name = overrides.name ?? `Com-${uniq()}`;
  const community = await prisma.community.create({
    data: {
      name,
      address: 'C/ Test 1',
      city: 'Madrid',
      postalCode: '28001',
      country: 'ES',
      admins: overrides.adminId ? { create: { userId: overrides.adminId } } : undefined,
    },
  });
  return { id: community.id, name: community.name };
}

/**
 * Crea una unidad en una comunidad.
 */
export async function createUnit(communityId: string, overrides: Partial<{
  type: 'VIVIENDA' | 'LOCAL' | 'GARAJE' | 'TRASTERO';
  label: string;
  coefficient: number;
}> = {}): Promise<{ id: string; label: string; coefficient: number }> {
  const label = overrides.label ?? `U-${uniq()}`;
  const unit = await prisma.unit.create({
    data: {
      communityId,
      type: overrides.type ?? 'VIVIENDA',
      label,
      coefficient: overrides.coefficient ?? 10,
    },
  });
  return {
    id: unit.id,
    label: unit.label,
    coefficient: Number(unit.coefficient),
  };
}

/**
 * Marca a un usuario como propietario activo de una unidad.
 */
export async function setOwner(unitId: string, ownerId: string): Promise<void> {
  await prisma.ownership.create({
    data: { unitId, ownerId },
  });
}

/**
 * Marca a un usuario como ocupante activo de una unidad.
 */
export async function setOccupant(unitId: string, occupantId: string, isOwner = true): Promise<void> {
  await prisma.occupancy.create({
    data: { unitId, occupantId, isOwner },
  });
}

/**
 * Borra de la BBDD lo creado por el suite en orden seguro.
 * Útil en afterAll si has guardado los IDs.
 */
export async function cleanup(): Promise<void> {
  await prisma.payment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.procedureUpdate.deleteMany();
  await prisma.procedure.deleteMany();
  await prisma.ticketComment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.occupancy.deleteMany();
  await prisma.ownership.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.communityAdmin.deleteMany();
  await prisma.community.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany({ where: { email: { contains: '@test.example.com' } } });
}
