import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './invoices.service';
import { generateSepaXml } from './sepa.service';
import { generateInvoicePdf } from './pdf.service';
import {
  createInvoiceSchema,
  createPaymentSchema,
  listInvoicesQuerySchema,
  sepaExportSchema,
  bulkInvoiceSchema,
} from './invoices.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

// ─── Bajo /communities/:communityId/invoices ────────────────

export async function listByCommunity(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const filter = listInvoicesQuerySchema.parse(req.query);
  const invoices = await service.listCommunityInvoices(user.id, user.role, communityId, filter);
  res.json({ invoices });
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const input = createInvoiceSchema.parse(req.body);
  const invoice = await service.createInvoice(user.id, user.role, communityId, input);
  res.status(201).json({ invoice });
}

export async function overdue(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const overdueByOwner = await service.listOverdueByOwner(user.id, user.role, communityId);
  res.json({ overdueByOwner });
}

// ─── Bajo /invoices ──────────────────────────────────────────

export async function getOne(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const invoice = await service.getInvoice(user.id, user.role, id);
  res.json({ invoice });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const invoice = await service.cancelInvoice(user.id, user.role, id);
  res.json({ invoice });
}

// ─── Pagos ──────────────────────────────────────────────────

export async function recordPayment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { itemId } = z.object({ itemId: z.string().cuid() }).parse(req.params);
  const input = createPaymentSchema.parse(req.body);
  const payment = await service.recordPayment(user.id, user.role, itemId, input);
  res.status(201).json({ payment });
}

export async function deletePayment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { paymentId } = z.object({ paymentId: z.string().cuid() }).parse(req.params);
  await service.deletePayment(user.id, user.role, paymentId);
  res.status(204).send();
}

// ─── Vecino ─────────────────────────────────────────────────

export async function myInvoiceItems(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const items = await service.listMyInvoiceItems(user.id);
  res.json({ items });
}

// ─── SEPA Export ────────────────────────────────────────────

export async function exportSepa(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId, invoiceId } = z
    .object({ communityId: z.string().cuid(), invoiceId: z.string().cuid() })
    .parse(req.params);
  const body = sepaExportSchema.parse(req.body);
  const xml = await generateSepaXml(user.id, user.role, {
    communityId,
    invoiceId,
    creditorName: body.creditorName,
    creditorIban: body.creditorIban,
    creditorBic: body.creditorBic,
  });
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="sepa-${invoiceId}.xml"`);
  res.send(xml);
}

// ─── PDF Export ─────────────────────────────────────────────

export async function exportPdf(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId, invoiceId } = z
    .object({ communityId: z.string().cuid(), invoiceId: z.string().cuid() })
    .parse(req.params);
  const buffer = await generateInvoicePdf(user.id, user.role, communityId, invoiceId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`);
  res.send(buffer);
}

// ─── Bulk Invoice ────────────────────────────────────────────

export async function createBulk(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const input = bulkInvoiceSchema.parse(req.body);
  const invoice = await service.createBulkInvoice(user.id, user.role, communityId, input);
  res.status(201).json({ invoice });
}
