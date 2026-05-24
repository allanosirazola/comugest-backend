import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../config/prisma';
import {
  computeItemStatus,
  computeInvoiceStatus,
  cancelInvoice,
  recordPayment,
} from '../modules/invoices/invoices.service';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors';
import type { InvoiceItem, Payment, Invoice } from '@prisma/client';

// Cast to any: vi.mocked doesn't penetrate Prisma's generated client types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

// ─── Helpers ────────────────────────────────────────────────

function makePayment(amount: number): Payment {
  return {
    id: 'pay-1',
    invoiceItemId: 'item-1',
    amount: amount as unknown as import('@prisma/client').Prisma.Decimal,
    paidAt: new Date(),
    method: 'BANK_TRANSFER',
    reference: null,
    notes: null,
    registeredById: 'user-1',
    createdAt: new Date(),
  };
}

function makeItem(amount: number, payments: Payment[] = []): InvoiceItem & { payments: Payment[] } {
  return {
    id: 'item-1',
    invoiceId: 'inv-1',
    unitId: 'unit-1',
    amount: amount as unknown as import('@prisma/client').Prisma.Decimal,
    consumptionValue: null,
    consumptionUnit: null,
    notes: null,
    reminderSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    payments,
  };
}

function makeInvoice(overrides: Partial<Invoice> = {}, items: ReturnType<typeof makeItem>[] = []) {
  return {
    id: 'inv-1',
    communityId: 'comm-1',
    type: 'INDIVIDUAL' as const,
    concept: 'Test',
    description: null,
    totalAmount: 100 as unknown as import('@prisma/client').Prisma.Decimal,
    issueDate: new Date('2025-01-01'),
    dueDate: new Date('2025-12-31'),
    attachmentUrl: null,
    issuedById: 'user-1',
    cancelledAt: null,
    recurringSourceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items,
    ...overrides,
  };
}

// ─── computeItemStatus ───────────────────────────────────────

describe('computeItemStatus', () => {
  const futureDue = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days from now
  const pastDue = new Date(Date.now() - 1000 * 60 * 60 * 24); // yesterday

  it('returns PAID when fully paid', () => {
    const item = makeItem(100, [makePayment(100)]);
    expect(computeItemStatus(item, futureDue)).toBe('PAID');
  });

  it('returns PAID when payment covers full amount with floating point tolerance', () => {
    const item = makeItem(100, [makePayment(99.999)]);
    expect(computeItemStatus(item, futureDue)).toBe('PAID');
  });

  it('returns PENDING when unpaid and due date in future', () => {
    const item = makeItem(100, []);
    expect(computeItemStatus(item, futureDue)).toBe('PENDING');
  });

  it('returns OVERDUE when unpaid and due date passed', () => {
    const item = makeItem(100, []);
    expect(computeItemStatus(item, pastDue)).toBe('OVERDUE');
  });

  it('returns PARTIALLY_PAID when partially paid and not yet due', () => {
    const item = makeItem(100, [makePayment(50)]);
    expect(computeItemStatus(item, futureDue)).toBe('PARTIALLY_PAID');
  });

  it('returns OVERDUE when partially paid and due date passed', () => {
    const item = makeItem(100, [makePayment(50)]);
    expect(computeItemStatus(item, pastDue)).toBe('OVERDUE');
  });
});

// ─── computeInvoiceStatus ────────────────────────────────────

describe('computeInvoiceStatus', () => {
  const futureDue = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  const pastDue = new Date(Date.now() - 1000 * 60 * 60 * 24);

  it('returns CANCELLED when cancelledAt is set', () => {
    const invoice = makeInvoice({ cancelledAt: new Date(), dueDate: pastDue }, [makeItem(100)]);
    expect(computeInvoiceStatus(invoice)).toBe('CANCELLED');
  });

  it('returns PAID when all items are paid', () => {
    const invoice = makeInvoice({ dueDate: futureDue }, [makeItem(100, [makePayment(100)])]);
    expect(computeInvoiceStatus(invoice)).toBe('PAID');
  });

  it('returns OVERDUE when any item is overdue', () => {
    const invoice = makeInvoice({ dueDate: pastDue }, [makeItem(100, [])]);
    expect(computeInvoiceStatus(invoice)).toBe('OVERDUE');
  });

  it('returns PARTIALLY_PAID when some items are paid', () => {
    const invoice = makeInvoice({ dueDate: futureDue }, [
      makeItem(100, [makePayment(100)]),
      makeItem(100, []),
    ]);
    expect(computeInvoiceStatus(invoice)).toBe('PARTIALLY_PAID');
  });

  it('returns PENDING when no items are paid and not yet due', () => {
    const invoice = makeInvoice({ dueDate: futureDue }, [makeItem(100, [])]);
    expect(computeInvoiceStatus(invoice)).toBe('PENDING');
  });
});

// ─── cancelInvoice ───────────────────────────────────────────

describe('cancelInvoice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFoundError when invoice does not exist', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.invoice.findUnique.mockResolvedValueOnce(null);
    await expect(cancelInvoice('user-1', 'ADMIN_FINCAS', 'inv-nonexistent')).rejects.toThrow(NotFoundError);
  });

  it('throws ConflictError when invoice already has payments', async () => {
    const invoice = makeInvoice({}, [makeItem(100, [makePayment(50)])]);
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.invoice.findUnique.mockResolvedValueOnce(invoice as any);
    await expect(cancelInvoice('user-1', 'ADMIN_FINCAS', 'inv-1')).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when invoice is already cancelled', async () => {
    const invoice = makeInvoice({ cancelledAt: new Date() }, [makeItem(100)]);
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.invoice.findUnique.mockResolvedValueOnce(invoice as any);
    await expect(cancelInvoice('user-1', 'ADMIN_FINCAS', 'inv-1')).rejects.toThrow(ConflictError);
  });

  it('cancels invoice and returns updated invoice', async () => {
    const invoice = makeInvoice({}, [makeItem(100)]);
    const cancelled = { ...invoice, cancelledAt: new Date() };
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.invoice.findUnique.mockResolvedValueOnce(invoice as any);
    mockPrisma.invoice.update.mockResolvedValueOnce(cancelled as any);
    const result = await cancelInvoice('user-1', 'ADMIN_FINCAS', 'inv-1');
    expect(result.cancelledAt).toBeTruthy();
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: expect.objectContaining({ cancelledAt: expect.any(Date) }),
    });
  });
});

// ─── recordPayment ───────────────────────────────────────────

describe('recordPayment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFoundError when invoice item not found', async () => {
    mockPrisma.invoiceItem.findUnique.mockResolvedValueOnce(null);
    await expect(
      recordPayment('user-1', 'ADMIN_FINCAS', 'item-missing', { amount: 50, method: 'CASH' })
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when payment amount exceeds remaining balance', async () => {
    const item = {
      ...makeItem(100, [makePayment(80)]),
      invoice: makeInvoice(),
    };
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.invoiceItem.findUnique.mockResolvedValueOnce(item as any);
    await expect(
      recordPayment('user-1', 'ADMIN_FINCAS', 'item-1', { amount: 25, method: 'CASH' })
    ).rejects.toThrow(ValidationError);
  });

  it('creates payment when amount is valid', async () => {
    const item = {
      ...makeItem(100, [makePayment(40)]),
      invoice: makeInvoice(),
    };
    const payment = makePayment(60);
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.invoiceItem.findUnique.mockResolvedValueOnce(item as any);
    mockPrisma.payment.create.mockResolvedValueOnce(payment as any);
    const result = await recordPayment('user-1', 'ADMIN_FINCAS', 'item-1', { amount: 60, method: 'CASH' });
    expect(mockPrisma.payment.create).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ id: 'pay-1' });
  });

  it('throws ValidationError when paying full amount twice', async () => {
    const item = {
      ...makeItem(100, [makePayment(100)]),
      invoice: makeInvoice(),
    };
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.invoiceItem.findUnique.mockResolvedValueOnce(item as any);
    await expect(
      recordPayment('user-1', 'ADMIN_FINCAS', 'item-1', { amount: 0.01, method: 'CASH' })
    ).rejects.toThrow(ValidationError);
  });
});
