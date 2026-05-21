import { prisma } from '../../config/prisma';
import { Prisma, type UserRole, type Invoice, type InvoiceItem, type Payment } from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors';
import { assertCommunityAccess } from '../../utils/authz';
import { distributeByCoefficient, eurosToCents, centsToEuros } from '../../utils/money';
import { sendEmail } from '../email/email.service';
import { buildFrontendUrl } from '../email/templates';
import type { CreateInvoiceInput, CreatePaymentInput, ListInvoicesQuery } from './invoices.schemas';

// ─── Estado calculado ───────────────────────────────────────

export type ComputedItemStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';
export type ComputedInvoiceStatus = ComputedItemStatus | 'CANCELLED';

interface ItemWithPayments extends InvoiceItem {
  payments: Payment[];
}

interface InvoiceWithItems extends Invoice {
  items: ItemWithPayments[];
}

export function computeItemStatus(item: ItemWithPayments, dueDate: Date): ComputedItemStatus {
  const paid = item.payments.reduce((acc, p) => acc + Number(p.amount), 0);
  const amount = Number(item.amount);
  if (paid >= amount - 0.005) return 'PAID';
  if (paid > 0) {
    return new Date() > dueDate ? 'OVERDUE' : 'PARTIALLY_PAID';
  }
  return new Date() > dueDate ? 'OVERDUE' : 'PENDING';
}

export function computeInvoiceStatus(invoice: InvoiceWithItems): ComputedInvoiceStatus {
  if (invoice.cancelledAt) return 'CANCELLED';
  const statuses = invoice.items.map((it) => computeItemStatus(it, invoice.dueDate));
  if (statuses.every((s) => s === 'PAID')) return 'PAID';
  if (statuses.some((s) => s === 'OVERDUE')) return 'OVERDUE';
  if (statuses.some((s) => s === 'PARTIALLY_PAID' || s === 'PAID')) return 'PARTIALLY_PAID';
  return 'PENDING';
}

// Resumen de importes pagados / pendientes
function summarizeAmounts(items: ItemWithPayments[]): { paidAmount: number; pendingAmount: number; total: number } {
  let paid = 0;
  let total = 0;
  for (const it of items) {
    total += Number(it.amount);
    paid += it.payments.reduce((acc, p) => acc + Number(p.amount), 0);
  }
  return { paidAmount: round2(paid), pendingAmount: round2(total - paid), total: round2(total) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Crear factura ──────────────────────────────────────────

export async function createInvoice(
  userId: string,
  userRole: UserRole,
  communityId: string,
  input: CreateInvoiceInput
): Promise<InvoiceWithItems & { status: ComputedInvoiceStatus }> {
  await assertCommunityAccess(userId, userRole, communityId);

  // Cargar unidades de la comunidad
  const units = await prisma.unit.findMany({
    where: { communityId },
    orderBy: [{ type: 'asc' }, { label: 'asc' }],
  });
  if (units.length === 0) {
    throw new ValidationError('La comunidad no tiene unidades. Añade unidades antes de emitir facturas.');
  }

  // Construir los items según el tipo
  const itemsToCreate: Array<{ unitId: string; amount: number; consumptionValue?: number | null; consumptionUnit?: string | null; notes?: string | null }> = [];

  if (input.type === 'DERRAMA') {
    const candidateUnits = input.unitIds
      ? units.filter((u) => input.unitIds!.includes(u.id))
      : units;

    if (candidateUnits.length === 0) {
      throw new ValidationError('No se han seleccionado unidades válidas para la derrama');
    }

    const shares = candidateUnits.map((u) => Number(u.coefficient));
    const sumShares = shares.reduce((a, b) => a + b, 0);
    if (sumShares <= 0) {
      throw new ValidationError(
        'Las unidades seleccionadas tienen coeficiente 0. Revisa los coeficientes antes de crear la derrama.'
      );
    }

    const totalCents = eurosToCents(input.totalAmount);
    const portions = distributeByCoefficient(totalCents, shares);

    candidateUnits.forEach((u, idx) => {
      itemsToCreate.push({
        unitId: u.id,
        amount: centsToEuros(portions[idx]),
      });
    });
  } else {
    // INDIVIDUAL: items vienen del input
    const unitIds = new Set(units.map((u) => u.id));
    for (const item of input.items) {
      if (!unitIds.has(item.unitId)) {
        throw new ValidationError(`La unidad ${item.unitId} no pertenece a esta comunidad`);
      }
      itemsToCreate.push({
        unitId: item.unitId,
        amount: item.amount,
        consumptionValue: item.consumptionValue ?? null,
        consumptionUnit: item.consumptionUnit ?? null,
        notes: item.notes ?? null,
      });
    }
    // Comprobar unitIds únicos
    const ids = itemsToCreate.map((i) => i.unitId);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationError('Hay unidades duplicadas en los items');
    }
  }

  // Si es INDIVIDUAL, totalAmount = suma de items
  const computedTotal =
    input.type === 'INDIVIDUAL' ? round2(itemsToCreate.reduce((a, b) => a + b.amount, 0)) : input.totalAmount;

  const invoice = await prisma.invoice.create({
    data: {
      communityId,
      type: input.type,
      concept: input.concept,
      description: input.description ?? null,
      totalAmount: new Prisma.Decimal(computedTotal),
      issueDate: input.issueDate ?? new Date(),
      dueDate: input.dueDate,
      attachmentUrl: input.attachmentUrl ?? null,
      issuedById: userId,
      items: {
        create: itemsToCreate.map((it) => ({
          unitId: it.unitId,
          amount: new Prisma.Decimal(it.amount),
          consumptionValue: it.consumptionValue !== null && it.consumptionValue !== undefined ? new Prisma.Decimal(it.consumptionValue) : null,
          consumptionUnit: it.consumptionUnit ?? null,
          notes: it.notes ?? null,
        })),
      },
    },
    include: { items: { include: { payments: true, unit: true } } },
  });

  // Enviar emails a los propietarios activos de cada unidad
  await notifyInvoiceIssued(invoice).catch(() => {
    // No bloqueamos la creación si el envío falla. Lo loguea el servicio de email.
  });

  return { ...invoice, status: computeInvoiceStatus(invoice) };
}

async function notifyInvoiceIssued(invoice: InvoiceWithItems): Promise<void> {
  // Cargamos los propietarios activos de cada unidad afectada
  const unitIds = invoice.items.map((i) => i.unitId);
  const ownerships = await prisma.ownership.findMany({
    where: { unitId: { in: unitIds }, endDate: null },
    include: { owner: true, unit: true },
  });

  const community = await prisma.community.findUnique({ where: { id: invoice.communityId } });

  for (const ownership of ownerships) {
    const item = invoice.items.find((i) => i.unitId === ownership.unitId);
    if (!item || !community) continue;
    await sendEmail({
      to: ownership.owner.email,
      template: 'invoiceIssued',
      locale: (ownership.owner.locale as 'es' | 'en') ?? 'es',
      vars: {
        firstName: ownership.owner.firstName,
        communityName: community.name,
        unitLabel: ownership.unit.label,
        concept: invoice.concept,
        amount: Number(item.amount).toFixed(2),
        dueDate: invoice.dueDate.toISOString().slice(0, 10),
        viewUrl: buildFrontendUrl(`/invoices/${invoice.id}`),
      },
    });
  }
}

// ─── Listados ───────────────────────────────────────────────

export async function listCommunityInvoices(
  userId: string,
  userRole: UserRole,
  communityId: string,
  filter: ListInvoicesQuery
) {
  await assertCommunityAccess(userId, userRole, communityId);

  const where: Prisma.InvoiceWhereInput = {
    communityId,
    cancelledAt: null,
  };
  if (filter.type) where.type = filter.type;

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: { issueDate: 'desc' },
    include: { items: { include: { payments: true, unit: true } } },
  });

  const decorated = invoices.map((inv) => ({
    ...inv,
    status: computeInvoiceStatus(inv),
    ...summarizeAmounts(inv.items),
  }));

  // Filtro post-query por estado computado
  switch (filter.status) {
    case 'PAID':
      return decorated.filter((d) => d.status === 'PAID');
    case 'UNPAID':
      return decorated.filter((d) => d.status === 'PENDING' || d.status === 'PARTIALLY_PAID' || d.status === 'OVERDUE');
    case 'OVERDUE':
      return decorated.filter((d) => d.status === 'OVERDUE');
    default:
      return decorated;
  }
}

export async function getInvoice(userId: string, userRole: UserRole, invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      community: true,
      issuedBy: { select: { firstName: true, lastName: true, email: true } },
      items: {
        include: {
          payments: { orderBy: { paidAt: 'desc' } },
          unit: true,
        },
      },
    },
  });
  if (!invoice) throw new NotFoundError('Factura no encontrada');
  await assertCommunityAccess(userId, userRole, invoice.communityId);

  return {
    ...invoice,
    status: computeInvoiceStatus(invoice),
    ...summarizeAmounts(invoice.items),
    items: invoice.items.map((it) => ({
      ...it,
      status: computeItemStatus(it, invoice.dueDate),
    })),
  };
}

/**
 * Lista los items de factura que un vecino puede ver.
 * Un vecino ve los items cuya unidad gestiona (propietario u ocupante actual).
 */
export async function listMyInvoiceItems(userId: string) {
  // Unidades en las que el usuario es propietario u ocupante activo
  const [ownerships, occupancies] = await Promise.all([
    prisma.ownership.findMany({ where: { ownerId: userId, endDate: null }, select: { unitId: true } }),
    prisma.occupancy.findMany({ where: { occupantId: userId, endDate: null }, select: { unitId: true } }),
  ]);
  const unitIds = Array.from(new Set([...ownerships.map((o) => o.unitId), ...occupancies.map((o) => o.unitId)]));
  if (unitIds.length === 0) return [];

  const items = await prisma.invoiceItem.findMany({
    where: { unitId: { in: unitIds }, invoice: { cancelledAt: null } },
    orderBy: { invoice: { issueDate: 'desc' } },
    include: {
      payments: true,
      unit: { select: { id: true, label: true, type: true } },
      invoice: {
        select: {
          id: true,
          concept: true,
          description: true,
          type: true,
          issueDate: true,
          dueDate: true,
          attachmentUrl: true,
          community: { select: { id: true, name: true } },
        },
      },
    },
  });

  return items.map((it) => ({
    ...it,
    status: computeItemStatus({ ...it, payments: it.payments } as ItemWithPayments, it.invoice.dueDate),
  }));
}

// ─── Pagos ──────────────────────────────────────────────────

export async function recordPayment(
  userId: string,
  userRole: UserRole,
  itemId: string,
  input: CreatePaymentInput
) {
  const item = await prisma.invoiceItem.findUnique({
    where: { id: itemId },
    include: { invoice: true, payments: true },
  });
  if (!item) throw new NotFoundError('Item no encontrado');
  await assertCommunityAccess(userId, userRole, item.invoice.communityId);

  const alreadyPaid = item.payments.reduce((acc, p) => acc + Number(p.amount), 0);
  const remaining = Number(item.amount) - alreadyPaid;
  if (input.amount > remaining + 0.005) {
    throw new ValidationError(
      `El importe (${input.amount.toFixed(2)}€) supera lo pendiente (${remaining.toFixed(2)}€) en este item.`
    );
  }

  return prisma.payment.create({
    data: {
      invoiceItemId: itemId,
      amount: new Prisma.Decimal(input.amount),
      paidAt: input.paidAt ?? new Date(),
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      registeredById: userId,
    },
  });
}

export async function deletePayment(userId: string, userRole: UserRole, paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoiceItem: { include: { invoice: true } } },
  });
  if (!payment) throw new NotFoundError('Pago no encontrado');
  await assertCommunityAccess(userId, userRole, payment.invoiceItem.invoice.communityId);
  await prisma.payment.delete({ where: { id: paymentId } });
}

export async function cancelInvoice(userId: string, userRole: UserRole, invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: { include: { payments: true } } },
  });
  if (!invoice) throw new NotFoundError('Factura no encontrada');
  await assertCommunityAccess(userId, userRole, invoice.communityId);

  const hasPayments = invoice.items.some((it) => it.payments.length > 0);
  if (hasPayments) {
    throw new ConflictError(
      'No se puede cancelar una factura con pagos registrados. Elimina los pagos primero.'
    );
  }
  if (invoice.cancelledAt) {
    throw new ConflictError('La factura ya está cancelada');
  }
  return prisma.invoice.update({
    where: { id: invoiceId },
    data: { cancelledAt: new Date() },
  });
}

// ─── Morosos ────────────────────────────────────────────────

/**
 * Devuelve los items en estado OVERDUE o no pagados, agrupados por unidad y por
 * vecino propietario, con totales pendientes. Vista de moros para el admin.
 */
export async function listOverdueByOwner(userId: string, userRole: UserRole, communityId: string) {
  await assertCommunityAccess(userId, userRole, communityId);

  const items = await prisma.invoiceItem.findMany({
    where: {
      invoice: { communityId, cancelledAt: null },
    },
    include: {
      payments: true,
      unit: {
        include: {
          ownerships: {
            where: { endDate: null },
            include: { owner: { select: { id: true, firstName: true, lastName: true, email: true } } },
          },
        },
      },
      invoice: { select: { id: true, concept: true, dueDate: true, issueDate: true, type: true } },
    },
  });

  // Filtrar a los OVERDUE
  const now = new Date();
  const overdueItems = items.filter((it) => {
    const paid = it.payments.reduce((a, p) => a + Number(p.amount), 0);
    return paid < Number(it.amount) - 0.005 && it.invoice.dueDate < now;
  });

  // Agrupar por propietario actual
  const byOwner = new Map<
    string,
    { owner: { id: string; firstName: string; lastName: string; email: string }; items: typeof overdueItems; totalPending: number }
  >();

  for (const it of overdueItems) {
    const owner = it.unit.ownerships[0]?.owner;
    if (!owner) continue;
    const paid = it.payments.reduce((a, p) => a + Number(p.amount), 0);
    const pending = Number(it.amount) - paid;
    const entry = byOwner.get(owner.id) ?? { owner, items: [], totalPending: 0 };
    entry.items.push(it);
    entry.totalPending += pending;
    byOwner.set(owner.id, entry);
  }

  return Array.from(byOwner.values()).map((e) => ({
    ...e,
    totalPending: round2(e.totalPending),
  }));
}
