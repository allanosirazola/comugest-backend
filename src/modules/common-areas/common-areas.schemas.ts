import { z } from 'zod';

export const createAreaSchema = z.object({
  name: z.string().min(1).trim(),
  description: z.string().optional(),
  capacity: z.coerce.number().int().min(1).optional(),
  openTime: z.string().default('08:00'),
  closeTime: z.string().default('22:00'),
  slotMinutes: z.number().int().refine((v) => [30, 60, 120].includes(v), {
    message: 'slotMinutes must be 30, 60, or 120',
  }).default(60),
  maxSlotsPerDay: z.coerce.number().int().min(1).max(10).default(2),
});
export type CreateAreaInput = z.infer<typeof createAreaSchema>;

export const updateAreaSchema = createAreaSchema.partial();
export type UpdateAreaInput = z.infer<typeof updateAreaSchema>;

export const createReservationSchema = z.object({
  areaId: z.string(),
  startAt: z.coerce.date(),
  notes: z.string().optional(),
});
export type CreateReservationInput = z.infer<typeof createReservationSchema>;
