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

export async function getBudgetVsActual(
  actorId: string,
  actorRole: UserRole,
  communityId: string,
  year: number
) {
  await assertCommunityAccess(actorId, actorRole, communityId);

  const from = new Date(`${year}-01-01`);
  const to = new Date(`${year + 1}-01-01`);

  // Get budget lines for the year
  const budgets = await prisma.budget.findMany({
    where: { communityId, year },
    include: { lines: true },
  }).catch(() => []);

  // Get actual expenses grouped by category
  const expenses = await prisma.expense.findMany({
    where: { communityId, expenseDate: { gte: from, lt: to } },
    select: { category: true, amount: true },
  });

  const actualByCategory = new Map<string, number>();
  for (const e of expenses) {
    actualByCategory.set(e.category, (actualByCategory.get(e.category) ?? 0) + Number(e.amount));
  }

  // Build comparison
  const budgetedCategories = new Set<string>();
  const lines = budgets.flatMap(b => b.lines ?? []).map((line) => {
    budgetedCategories.add(line.category);
    return {
      category: line.category,
      budgeted: Number(line.amount),
      actual: actualByCategory.get(line.category) ?? 0,
    };
  });

  // Add categories with actual expenses but no budget
  for (const [cat, amt] of actualByCategory) {
    if (!budgetedCategories.has(cat)) {
      lines.push({ category: cat, budgeted: 0, actual: amt });
    }
  }

  const totalBudgeted = lines.reduce((s, l) => s + l.budgeted, 0);
  const totalActual = lines.reduce((s, l) => s + l.actual, 0);

  return { year, lines, totalBudgeted, totalActual };
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
