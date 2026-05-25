import { z } from 'zod';

export const CreateDocumentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.enum(['ACTA', 'REGLAMENTO', 'PRESUPUESTO', 'CONTRATO', 'CERTIFICADO', 'OTRO']).default('OTRO'),
  url: z.string().url().max(2000),
  publicForResidents: z.boolean().default(true),
});

export const UpdateDocumentSchema = CreateDocumentSchema.partial();

export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>;
