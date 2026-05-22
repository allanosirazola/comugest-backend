import { z } from 'zod';

// ─── Crear factura ──────────────────────────────────────────

// Item individual cuando el admin lo introduce manualmente
const invoiceItemInputSchema = z.object({
  unitId: z.string().cuid(),
  amount: z.coerce.number().min(0).max(1_000_000),
  consumptionValue: z.coerce.number().min(0).optional().nullable(),
  consumptionUnit: z.string().max(10).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

// Para DERRAMA solo se necesita el total; el sistema reparte
const baseInvoiceFields = {
  concept: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).optional().nullable(),
  dueDate: z.coerce.date(),
  attachmentUrl: z.string().url().max(500).optional().nullable(),
  issueDate: z.coerce.date().optional(),
};

const derramaSchema = z.object({
  ...baseInvoiceFields,
  type: z.literal('DERRAMA'),
  totalAmount: z.coerce.number().positive().max(10_000_000),
  // Por defecto se reparte entre todas las unidades de la comunidad por
  // coefficient. Si se especifican unitIds, se reparte solo entre esas.
  unitIds: z.array(z.string().cuid()).optional(),
});

const individualSchema = z.object({
  ...baseInvoiceFields,
  type: z.literal('INDIVIDUAL'),
  items: z.array(invoiceItemInputSchema).min(1).max(500),
});

export const createInvoiceSchema = z.discriminatedUnion('type', [derramaSchema, individualSchema]);
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

// ─── Pagos ──────────────────────────────────────────────────

export const createPaymentSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000),
  paidAt: z.coerce.date().optional(),
  method: z.enum(['BANK_TRANSFER', 'CARD', 'CASH', 'DIRECT_DEBIT', 'OTHER']).default('BANK_TRANSFER'),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

// ─── Filtros de listado ─────────────────────────────────────

export const listInvoicesQuerySchema = z.object({
  status: z.enum(['ALL', 'PAID', 'UNPAID', 'OVERDUE']).optional().default('ALL'),
  type: z.enum(['DERRAMA', 'INDIVIDUAL']).optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

// ─── SEPA export ────────────────────────────────────────────

export const sepaExportSchema = z.object({
  creditorName: z.string().min(1).max(140),
  creditorIban: z.string().min(15).max(34).regex(/^[A-Z]{2}[0-9A-Z]+$/, 'IBAN inválido'),
  creditorBic: z.string().min(8).max(11).regex(/^[A-Z0-9]+$/, 'BIC inválido'),
});
export type SepaExportInput = z.infer<typeof sepaExportSchema>;
