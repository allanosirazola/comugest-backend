import { z } from 'zod';

// ─── Unidad (anidada al crear comunidad) ────────────────────

const unitInputSchema = z.object({
  type: z.enum(['VIVIENDA', 'LOCAL', 'GARAJE', 'TRASTERO']),
  label: z.string().min(1).max(50).trim(),
  floor: z.string().max(20).optional().nullable(),
  door: z.string().max(20).optional().nullable(),
  coefficient: z.coerce.number().min(0).max(100).default(0),
  surfaceM2: z.coerce.number().positive().optional().nullable(),
});

// ─── Comunidad ──────────────────────────────────────────────

export const createCommunitySchema = z.object({
  name: z.string().min(1).max(120).trim(),
  address: z.string().min(1).max(200).trim(),
  city: z.string().min(1).max(80).trim(),
  postalCode: z.string().min(1).max(20).trim(),
  country: z.string().length(2).default('ES'),
  cif: z.string().max(20).optional().nullable(),
  // Opcional: alta masiva de unidades al crear la comunidad
  units: z.array(unitInputSchema).max(500).optional().default([]),
});
export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;

export const updateCommunitySchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  address: z.string().min(1).max(200).trim().optional(),
  city: z.string().min(1).max(80).trim().optional(),
  postalCode: z.string().min(1).max(20).trim().optional(),
  cif: z.string().max(20).optional().nullable(),
  redirectMessagesTo: z.string().max(200).optional().nullable(),
});
export type UpdateCommunityInput = z.infer<typeof updateCommunitySchema>;

export const communityIdParamSchema = z.object({
  id: z.string().cuid(),
});
