import { z } from 'zod';

export const CreateSupplierSchema = z.object({
  name: z.string().min(1).max(200),
  cif: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(30).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export const UpdateSupplierSchema = CreateSupplierSchema.partial();

export type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof UpdateSupplierSchema>;
