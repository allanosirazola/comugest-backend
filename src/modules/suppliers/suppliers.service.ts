import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { assertCommunityAccess } from '../../utils/authz';
import { NotFoundError } from '../../utils/errors';
import type { UserRole } from '@prisma/client';
import type { CreateSupplierInput, UpdateSupplierInput } from './suppliers.schemas';

const supplierSelect = {
  id: true,
  communityId: true,
  name: true,
  cif: true,
  email: true,
  phone: true,
  address: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export async function listSuppliers(communityId: string) {
  return prisma.supplier.findMany({
    where: { communityId },
    select: {
      ...supplierSelect,
      _count: { select: { expenses: true } },
    },
    orderBy: { name: 'asc' },
  });
}

export async function getSupplier(id: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    select: {
      ...supplierSelect,
      expenses: {
        select: {
          id: true,
          amount: true,
          concept: true,
          expenseDate: true,
        },
        orderBy: { expenseDate: 'desc' },
        take: 10,
      },
    },
  });
  if (!supplier) throw new NotFoundError('Supplier not found');
  return supplier;
}

export async function createSupplier(
  actorId: string,
  actorRole: UserRole,
  communityId: string,
  input: CreateSupplierInput,
) {
  await assertCommunityAccess(actorId, actorRole, communityId);
  const supplier = await prisma.supplier.create({
    data: { communityId, createdById: actorId, ...input },
    select: supplierSelect,
  });
  void audit({
    action: 'SUPPLIER_CREATED',
    actorId,
    communityId,
    targetType: 'Supplier',
    targetId: supplier.id,
    meta: { name: supplier.name },
  });
  return supplier;
}

export async function updateSupplier(
  actorId: string,
  actorRole: UserRole,
  id: string,
  input: UpdateSupplierInput,
) {
  const existing = await prisma.supplier.findUnique({
    where: { id },
    select: { id: true, communityId: true, name: true },
  });
  if (!existing) throw new NotFoundError('Supplier not found');
  await assertCommunityAccess(actorId, actorRole, existing.communityId);
  const supplier = await prisma.supplier.update({
    where: { id },
    data: input,
    select: supplierSelect,
  });
  void audit({
    action: 'SUPPLIER_UPDATED',
    actorId,
    communityId: existing.communityId,
    targetType: 'Supplier',
    targetId: id,
    meta: { name: supplier.name },
  });
  return supplier;
}

export async function deleteSupplier(
  actorId: string,
  actorRole: UserRole,
  id: string,
) {
  const existing = await prisma.supplier.findUnique({
    where: { id },
    select: { id: true, communityId: true, name: true },
  });
  if (!existing) throw new NotFoundError('Supplier not found');
  await assertCommunityAccess(actorId, actorRole, existing.communityId);
  await prisma.supplier.delete({ where: { id } });
  void audit({
    action: 'SUPPLIER_DELETED',
    actorId,
    communityId: existing.communityId,
    targetType: 'Supplier',
    targetId: id,
    meta: { name: existing.name },
  });
}
