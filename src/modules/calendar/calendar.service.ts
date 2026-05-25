import { prisma } from '../../config/prisma';

export type CalendarEventType = 'MEETING' | 'RESERVATION' | 'INVOICE_DUE' | 'RECURRING';

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  date: string; // ISO date string
  endDate?: string;
  meta?: Record<string, unknown>;
}

export async function getCommunityCalendar(
  communityId: string,
  from: Date,
  to: Date,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];

  // 1. Meetings
  const meetings = await prisma.meeting.findMany({
    where: { communityId, scheduledAt: { gte: from, lte: to } },
    select: { id: true, title: true, scheduledAt: true, type: true, status: true },
  });
  for (const m of meetings) {
    events.push({
      id: `meeting-${m.id}`,
      type: 'MEETING',
      title: m.title,
      date: m.scheduledAt.toISOString(),
      meta: { meetingId: m.id, meetingType: m.type, status: m.status },
    });
  }

  // 2. Reservations (confirmed)
  const reservations = await prisma.reservation.findMany({
    where: {
      area: { communityId },
      status: 'CONFIRMED',
      startAt: { gte: from, lte: to },
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      area: { select: { name: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });
  for (const r of reservations) {
    events.push({
      id: `reservation-${r.id}`,
      type: 'RESERVATION',
      title: `${r.area.name} — ${r.user.firstName} ${r.user.lastName}`,
      date: r.startAt.toISOString(),
      endDate: r.endAt.toISOString(),
      meta: { reservationId: r.id, areaName: r.area.name },
    });
  }

  // 3. Invoice due dates
  const invoices = await prisma.invoice.findMany({
    where: { communityId, cancelledAt: null, dueDate: { gte: from, lte: to } },
    select: { id: true, concept: true, dueDate: true, type: true },
  });
  for (const inv of invoices) {
    events.push({
      id: `invoice-${inv.id}`,
      type: 'INVOICE_DUE',
      title: inv.concept,
      date: inv.dueDate.toISOString(),
      meta: { invoiceId: inv.id, invoiceType: inv.type },
    });
  }

  // 4. Recurring invoice next billing dates
  const recurring = await prisma.recurringInvoice.findMany({
    where: { communityId, active: true, nextBillingAt: { gte: from, lte: to } },
    select: { id: true, concept: true, nextBillingAt: true, frequency: true },
  });
  for (const r of recurring) {
    events.push({
      id: `recurring-${r.id}`,
      type: 'RECURRING',
      title: r.concept,
      date: r.nextBillingAt.toISOString(),
      meta: { recurringId: r.id, frequency: r.frequency },
    });
  }

  // Sort by date
  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

export async function getMyCalendar(userId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];

  // My meeting attendances
  const attendances = await prisma.meetingAttendee.findMany({
    where: { userId, meeting: { scheduledAt: { gte: from, lte: to } } },
    include: {
      meeting: {
        select: { id: true, title: true, scheduledAt: true, type: true, communityId: true },
      },
    },
  });
  for (const a of attendances) {
    events.push({
      id: `meeting-${a.meeting.id}`,
      type: 'MEETING',
      title: a.meeting.title,
      date: a.meeting.scheduledAt.toISOString(),
      meta: { meetingId: a.meeting.id, meetingType: a.meeting.type },
    });
  }

  // My confirmed reservations
  const reservations = await prisma.reservation.findMany({
    where: { userId, status: 'CONFIRMED', startAt: { gte: from, lte: to } },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      area: { select: { name: true } },
    },
  });
  for (const r of reservations) {
    events.push({
      id: `reservation-${r.id}`,
      type: 'RESERVATION',
      title: r.area.name,
      date: r.startAt.toISOString(),
      endDate: r.endAt.toISOString(),
      meta: { reservationId: r.id },
    });
  }

  // My pending/overdue invoice items
  const invoiceItems = await prisma.invoiceItem.findMany({
    where: {
      unit: {
        OR: [
          { ownerships: { some: { ownerId: userId } } },
          { occupancies: { some: { occupantId: userId } } },
        ],
      },
      invoice: { cancelledAt: null, dueDate: { gte: from, lte: to } },
    },
    include: {
      invoice: { select: { id: true, concept: true, dueDate: true } },
      payments: true,
    },
  });
  for (const item of invoiceItems) {
    const paid = item.payments.reduce((s, p) => s + Number(p.amount), 0);
    if (paid >= Number(item.amount) - 0.005) continue; // skip fully paid
    events.push({
      id: `invoice-${item.invoice.id}`,
      type: 'INVOICE_DUE',
      title: item.invoice.concept,
      date: item.invoice.dueDate.toISOString(),
      meta: { invoiceId: item.invoice.id },
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}
