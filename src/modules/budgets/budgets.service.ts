import { prisma } from '../../config/prisma';
import { Prisma, type UserRole } from '@prisma/client';
import { NotFoundError } from '../../utils/errors';
import { assertCommunityAccess } from '../../utils/authz';
import type { UpsertBudgetInput } from './budgets.schemas';

export async function upsertBudget(
  userId: string,
  userRole: UserRole,
  communityId: string,
  input: UpsertBudgetInput
) {
  await assertCommunityAccess(userId, userRole, communityId);

  const { year, lines } = input;

  const budget = await prisma.$transaction(async (tx) => {
    // Upsert the budget record
    const upserted = await tx.budget.upsert({
      where: { communityId_year: { communityId, year } },
      create: { communityId, year },
      update: { updatedAt: new Date() },
    });

    // Replace all lines
    await tx.budgetLine.deleteMany({ where: { budgetId: upserted.id } });
    await tx.budgetLine.createMany({
      data: lines.map((l) => ({
        budgetId: upserted.id,
        category: l.category,
        amount: new Prisma.Decimal(l.amount),
      })),
    });

    return tx.budget.findUniqueOrThrow({
      where: { id: upserted.id },
      include: { lines: true },
    });
  });

  return budget;
}

export async function getBudget(
  userId: string,
  userRole: UserRole,
  communityId: string,
  year: number
) {
  await assertCommunityAccess(userId, userRole, communityId);

  const budget = await prisma.budget.findUnique({
    where: { communityId_year: { communityId, year } },
    include: { lines: true },
  });

  if (!budget) throw new NotFoundError('Presupuesto no encontrado');

  return budget;
}

export async function getBudgetSummary(
  userId: string,
  userRole: UserRole,
  communityId: string,
  year: number
) {
  await assertCommunityAccess(userId, userRole, communityId);

  const budget = await prisma.budget.findUnique({
    where: { communityId_year: { communityId, year } },
    include: { lines: true },
  });

  if (!budget) throw new NotFoundError('Presupuesto no encontrado');

  // Compute actual spend per category for the given year
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

  const actuals = await prisma.expense.groupBy({
    by: ['category'],
    where: {
      communityId,
      expenseDate: { gte: startOfYear, lte: endOfYear },
    },
    _sum: { amount: true },
  });

  const actualMap = new Map<string, number>();
  for (const row of actuals) {
    actualMap.set(row.category, Number(row._sum.amount ?? 0));
  }

  const lines = budget.lines.map((line) => {
    const budgeted = Number(line.amount);
    const actual = actualMap.get(line.category) ?? 0;
    return {
      category: line.category,
      budgeted,
      actual,
      variance: budgeted - actual,
    };
  });

  return { year, lines };
}
