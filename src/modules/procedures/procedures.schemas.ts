import { z } from 'zod';

export const PROCEDURE_TYPES = [
  'CERTIFICATE',
  'MAINTENANCE',
  'DOCUMENT_REQUEST',
  'COMPLAINT',
  'PERMISSION',
  'OTHER',
] as const;

export const PROCEDURE_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'] as const;

// El vecino crea el trámite en una de sus comunidades
export const createProcedureSchema = z.object({
  communityId: z.string().cuid(),
  type: z.enum(PROCEDURE_TYPES),
  subject: z.string().min(1).max(200).trim(),
  description: z.string().min(1).max(5000).trim(),
  unitId: z.string().cuid().optional().nullable(),
});
export type CreateProcedureInput = z.infer<typeof createProcedureSchema>;

// El admin actualiza estado/resolución/adjunto
export const updateProcedureSchema = z.object({
  status: z.enum(PROCEDURE_STATUSES).optional(),
  resolution: z.string().max(5000).optional().nullable(),
  attachmentUrl: z.string().url().max(500).optional().nullable(),
});
export type UpdateProcedureInput = z.infer<typeof updateProcedureSchema>;

export const addUpdateSchema = z.object({
  body: z.string().min(1).max(5000).trim(),
});
export type AddUpdateInput = z.infer<typeof addUpdateSchema>;

export const listProceduresQuerySchema = z.object({
  status: z.enum(PROCEDURE_STATUSES).optional(),
  type: z.enum(PROCEDURE_TYPES).optional(),
});
export type ListProceduresQuery = z.infer<typeof listProceduresQuerySchema>;
