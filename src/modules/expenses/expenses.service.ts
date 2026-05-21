import { prisma } from '../../config/prisma';
import { Prisma, type UserRole, type ExpenseCategory } from '@prisma/client';
import { NotFoundError, ForbiddenError } from '../../utils/errors';
import { assertCommunityAccess } from '../../utils/authz';
import type { CreateExpenseInput, UpdateExpenseInput, ListExpensesQuery } from './expenses.schemas';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface CategorySummary {
  category: ExpenseCategory;
  total: number;
  count: number;
  percentage: number;
}

function buildSummary(expenses: Array<{ category: ExpenseCategory; amount: Prisma.Decimal }>): {
  total: number;
  byCategory: CategorySummary[];
} {
  const map = new Map<ExpenseCategory, { total: number; count: number }>();
  let total = 0;
  for (const e of expenses) {
    const amt = Number(e.amount);
    total += amt;
    const entry = map.get(e.category) ?? { total: 0, count: 0 };
    entry.total += amt;
    entry.count += 1;
    map.set(e.category, entry);
  }
  const byCategory: CategorySummary[] = Array.from(map.entries())
    .map(([category, v]) => ({
      category,
      total: round2(v.total),
      count: v.count,
      percentage: total > 0 ? round2((v.total / total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);
  return { total: round2(total), byCategory };
}

function buildDateFilter(filter: ListExpensesQuery): Prisma.ExpenseWhereInput {
  const where: Prisma.ExpenseWhereInput = {};
  if (filter.category) where.category = filter.category;
  if (filter.from || filter.to) {
    where.expenseDate = {};
    if (filter.from) where.expenseDate.gte = filter.from;
    if (filter.to) where.expenseDate.lte = filter.to;
  }
  return where;
}

export async function listExpenses(
  userId: string,
  userRole: UserRole,
  communityId: string,
  filter: ListExpensesQuery
) {
  await assertCommunityAccess(userId, userRole, communityId);

  const where = { communityId, ...buildDateFilter(filter) };
  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { expenseDate: 'desc' },
    include: { recordedBy: { select: { firstName: true, lastName: true } } },
  });

  const summary = buildSummary(expenses);
  return { expenses, summary };
}

export async function createExpense(
  userId: string,
  userRole: UserRole,
  communityId: string,
  input: CreateExpenseInput
) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.expense.create({
    data: {
      communityId,
      category: input.category,
      concept: input.concept,
      description: input.description ?? null,
      amount: new Prisma.Decimal(input.amount),
      expenseDate: input.expenseDate,
      supplier: input.supplier ?? null,
      attachmentUrl: input.attachmentUrl ?? null,
      recordedById: userId,
    },
  });
}

export async function updateExpense(
  userId: string,
  userRole: UserRole,
  id: string,
  input: UpdateExpenseInput
) {
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Gasto no encontrado');
  await assertCommunityAccess(userId, userRole, existing.communityId);

  return prisma.expense.update({
    where: { id },
    data: {
      ...input,
      amount: input.amount !== undefined ? new Prisma.Decimal(input.amount) : undefined,
    },
  });
}

export async function deleteExpense(userId: string, userRole: UserRole, id: string) {
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Gasto no encontrado');
  await assertCommunityAccess(userId, userRole, existing.communityId);
  await prisma.expense.delete({ where: { id } });
}

/**
 * Vista de transparencia para el vecino: gastos de una comunidad a la que
 * pertenece. Solo lectura. Devuelve resumen por categoría + lista.
 */
export async function listExpensesForResident(
  userId: string,
  communityId: string,
  filter: ListExpensesQuery
) {
  // Verificar pertenencia (propietario u ocupante activo)
  const belongs =
    (await prisma.ownership.count({ where: { ownerId: userId, endDate: null, unit: { communityId } } })) > 0 ||
    (await prisma.occupancy.count({ where: { occupantId: userId, endDate: null, unit: { communityId } } })) > 0;
  if (!belongs) throw new ForbiddenError('No perteneces a esta comunidad');

  const where = { communityId, ...buildDateFilter(filter) };
  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { expenseDate: 'desc' },
    // El vecino no ve quién lo registró ni la factura interna; solo concepto/categoría/importe/fecha
    select: {
      id: true,
      category: true,
      concept: true,
      description: true,
      amount: true,
      expenseDate: true,
      supplier: true,
    },
  });

  const summary = buildSummary(expenses);
  return { expenses, summary };
}
