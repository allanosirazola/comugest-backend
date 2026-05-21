import { z } from 'zod';

export const createUnitSchema = z.object({
  type: z.enum(['VIVIENDA', 'LOCAL', 'GARAJE', 'TRASTERO']),
  label: z.string().min(1).max(50).trim(),
  floor: z.string().max(20).optional().nullable(),
  door: z.string().max(20).optional().nullable(),
  coefficient: z.coerce.number().min(0).max(100).default(0),
  surfaceM2: z.coerce.number().positive().optional().nullable(),
  customFields: z.record(z.unknown()).optional().default({}),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = z.object({
  type: z.enum(['VIVIENDA', 'LOCAL', 'GARAJE', 'TRASTERO']).optional(),
  label: z.string().min(1).max(50).trim().optional(),
  floor: z.string().max(20).optional().nullable(),
  door: z.string().max(20).optional().nullable(),
  coefficient: z.coerce.number().min(0).max(100).optional(),
  surfaceM2: z.coerce.number().positive().optional().nullable(),
  customFields: z.record(z.unknown()).optional(),
});
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

export const unitIdParamSchema = z.object({
  id: z.string().cuid(),
});

export const communityIdParamSchema = z.object({
  communityId: z.string().cuid(),
});
