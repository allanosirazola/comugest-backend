import { z } from 'zod';

export const EXPENSE_CATEGORIES = [
  'CLEANING',
  'LIFT',
  'GARBAGE',
  'GARDENING',
  'MAINTENANCE',
  'INSURANCE',
  'ELECTRICITY',
  'WATER',
  'SECURITY',
  'ADMIN_FEES',
  'SUPPLIES',
  'OTHER',
] as const;

export const createExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  concept: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).optional().nullable(),
  amount: z.coerce.number().positive().max(10_000_000),
  expenseDate: z.coerce.date(),
  supplier: z.string().max(120).optional().nullable(),
  attachmentUrl: z.string().url().max(500).optional().nullable(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema.partial();
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
