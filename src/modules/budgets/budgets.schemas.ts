import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '../expenses/expenses.schemas';

export const upsertBudgetSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  lines: z
    .array(
      z.object({
        category: z.enum(EXPENSE_CATEGORIES),
        amount: z.coerce.number().nonnegative().max(100_000_000),
      })
    )
    .min(1),
});

export type UpsertBudgetInput = z.infer<typeof upsertBudgetSchema>;
