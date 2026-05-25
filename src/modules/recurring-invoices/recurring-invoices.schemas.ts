import { z } from 'zod';

export const recurringFrequencyEnum = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']);

export const createRecurringSchema = z.object({
  concept: z.string().min(1, 'El concepto es obligatorio'),
  description: z.string().optional(),
  frequency: recurringFrequencyEnum,
  amount: z.number().positive('El importe debe ser positivo'),
  dayOfMonth: z.number().int().min(1).max(28).default(1),
  startAt: z.string().optional(), // ISO date string, optional
});

export const updateRecurringSchema = z.object({
  concept: z.string().min(1).optional(),
  description: z.string().optional(),
  frequency: recurringFrequencyEnum.optional(),
  amount: z.number().positive().optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  active: z.boolean().optional(),
});

export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;
