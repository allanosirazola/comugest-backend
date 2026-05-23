import { z } from 'zod';

export const CreateMeterReadingSchema = z.object({
  unitId: z.string().min(1),
  type: z.enum(['AGUA', 'LUZ', 'GAS', 'OTRO']).default('AGUA'),
  readingDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  value: z.number().positive(),
  notes: z.string().max(500).optional(),
});

export type CreateMeterReadingInput = z.infer<typeof CreateMeterReadingSchema>;
