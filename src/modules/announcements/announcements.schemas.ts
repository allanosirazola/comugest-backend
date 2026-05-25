import { z } from 'zod';

export const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  body: z.string().min(1).max(10_000).trim(),
  pinned: z.boolean().optional().default(false),
  notify: z.boolean().optional().default(true), // enviar email a los vecinos
  expiresAt: z.coerce.date().optional().nullable(),
});
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export const updateAnnouncementSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  body: z.string().min(1).max(10_000).trim().optional(),
  pinned: z.boolean().optional(),
  expiresAt: z.coerce.date().optional().nullable(),
});
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
