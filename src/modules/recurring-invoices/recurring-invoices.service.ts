import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { Prisma } from '@prisma/client';
import { assertCommunityAccess } from '../../utils/authz';
import { distributeByCoefficient, eurosToCents, centsToEuros } from '../../utils/money';
import { NotFoundError } from '../../utils/errors';
import { logger } from '../../config/logger';
import type { CreateRecurringInput, UpdateRecurringInput } from './recurring-invoices.schemas';

// ─── Date arithmetic ────────────────────────────────────────

/**
 * Returns the next Date that falls on `dayOfMonth` on or after `from`.
 * Months with fewer days clamp to the last day of that month.
 */
function nextOccurrence(from: Date, dayOfMonth: number): Date {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);

  // Try same month first
  const candidate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dayOfMonth));
  if (candidate >= d) return candidate;

  // Otherwise move to next month
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, dayOfMonth));
}

function advanceDate(from: Date, frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY', dayOfMonth: number): Date {
  const monthsToAdd = frequency === 'MONTHLY' ? 1 : frequency === 'QUARTERLY' ? 3 : 12;
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + monthsToAdd, dayOfMonth));
}

// ─── List ───────────────────────────────────────────────────

export async function listRecurring(communityId: string) {
  return prisma.recurringInvoice.findMany({
    where: { communityId },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
}

// ─── Create ─────────────────────────────────────────────────

export async function createRecurring(
  adminId: string,
  adminRole: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO',
  communityId: string,
  input: CreateRecurringInput
) {
  await assertCommunityAccess(adminId, adminRole, communityId);

  const baseDate = input.startAt ? new Date(input.startAt) : new Date();
  const nextBillingAt = nextOccurrence(baseDate, input.dayOfMonth);

  const recurring = await prisma.recurringInvoice.create({
    data: {
      communityId,
      concept: input.concept,
      description: input.description ?? null,
      frequency: input.frequency,
      amount: new Prisma.Decimal(input.amount),
      dayOfMonth: input.dayOfMonth,
      nextBillingAt,
      active: true,
      createdById: adminId,
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  void audit({
    action: 'RECURRING_INVOICE_CREATED',
    actorId: adminId,
    targetType: 'RecurringInvoice',
    targetId: recurring.id,
    communityId,
    meta: { concept: recurring.concept, frequency: recurring.frequency, amount: input.amount },
  });

  return recurring;
}

// ─── Update ─────────────────────────────────────────────────

export async function updateRecurring(
  adminId: string,
  adminRole: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO',
  id: string,
  input: UpdateRecurringInput
) {
  const existing = await prisma.recurringInvoice.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Factura recurrente no encontrada');

  await assertCommunityAccess(adminId, adminRole, existing.communityId);

  const updated = await prisma.recurringInvoice.update({
    where: { id },
    data: {
      ...(input.concept !== undefined && { concept: input.concept }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.frequency !== undefined && { frequency: input.frequency }),
      ...(input.amount !== undefined && { amount: new Prisma.Decimal(input.amount) }),
      ...(input.dayOfMonth !== undefined && { dayOfMonth: input.dayOfMonth }),
      ...(input.active !== undefined && { active: input.active }),
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  return updated;
}

// ─── Trigger (generate invoice) ──────────────────────────────

export async function triggerRecurring(recurringId: string, adminId?: string) {
  const recurring = await prisma.recurringInvoice.findUnique({
    where: { id: recurringId },
    include: { community: true },
  });
  if (!recurring) throw new NotFoundError('Factura recurrente no encontrada');

  // Load all active units with their coefficients
  const units = await prisma.unit.findMany({
    where: { communityId: recurring.communityId },
    include: {
      ownerships: {
        where: { endDate: null },
        take: 1,
      },
    },
    orderBy: [{ type: 'asc' }, { label: 'asc' }],
  });

  // Only units with coefficient > 0 participate in DERRAMA distribution
  const eligibleUnits = units.filter((u) => Number(u.coefficient) > 0);

  if (eligibleUnits.length === 0) {
    throw new NotFoundError('No hay unidades con coeficiente > 0 en esta comunidad');
  }

  const dueDate = new Date(recurring.nextBillingAt);
  dueDate.setUTCDate(dueDate.getUTCDate() + 30);

  const totalAmount = Number(recurring.amount);
  const shares = eligibleUnits.map((u) => Number(u.coefficient));
  const totalCents = eurosToCents(totalAmount);
  const portions = distributeByCoefficient(totalCents, shares);

  // Determine who issues the invoice: adminId if provided, else the creator
  const issuedById = adminId ?? recurring.createdById;

  const invoice = await prisma.invoice.create({
    data: {
      communityId: recurring.communityId,
      type: 'DERRAMA',
      concept: recurring.concept,
      description: recurring.description ?? null,
      totalAmount: new Prisma.Decimal(totalAmount),
      issueDate: new Date(),
      dueDate,
      issuedById,
      recurringSourceId: recurring.id,
      items: {
        create: eligibleUnits.map((u, idx) => ({
          unitId: u.id,
          amount: new Prisma.Decimal(centsToEuros(portions[idx])),
        })),
      },
    },
    include: { items: { include: { payments: true } } },
  });

  // Advance nextBillingAt
  const nextBillingAt = advanceDate(recurring.nextBillingAt, recurring.frequency, recurring.dayOfMonth);
  await prisma.recurringInvoice.update({
    where: { id: recurringId },
    data: { nextBillingAt },
  });

  void audit({
    action: 'RECURRING_INVOICE_TRIGGERED',
    actorId: adminId ?? null,
    targetType: 'Invoice',
    targetId: invoice.id,
    communityId: recurring.communityId,
    meta: {
      recurringId,
      concept: recurring.concept,
      totalAmount,
      nextBillingAt: nextBillingAt.toISOString(),
    },
  });

  return invoice;
}

// ─── Process all due (cron) ──────────────────────────────────

export async function processAllDue(): Promise<void> {
  const now = new Date();
  const dueItems = await prisma.recurringInvoice.findMany({
    where: {
      active: true,
      nextBillingAt: { lte: now },
    },
  });

  for (const r of dueItems) {
    try {
      await triggerRecurring(r.id);
      logger.info(`RecurringInvoice ${r.id} triggered successfully`);
    } catch (err) {
      logger.error(`Failed to trigger RecurringInvoice ${r.id}: ${String(err)}`);
    }
  }
}
