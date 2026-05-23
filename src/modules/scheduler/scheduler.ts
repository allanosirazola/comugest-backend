import { prisma } from '../../config/prisma';
import { sendEmail } from '../email/email.service';

// Check every 6 hours for overdue invoices and send reminders
export function startScheduler() {
  void runOverdueCheck();
  setInterval(() => void runOverdueCheck(), 6 * 60 * 60 * 1000);
}

async function runOverdueCheck() {
  try {
    const now = new Date();
    // Find invoice items overdue (dueDate passed) with no payments
    const overdueItems = await prisma.invoiceItem.findMany({
      where: {
        invoice: { dueDate: { lt: now } },
        payments: { none: {} },
      },
      include: {
        invoice: { select: { concept: true, dueDate: true, communityId: true } },
        unit: {
          include: {
            ownerships: {
              where: { endDate: null },
              take: 1,
              include: { owner: { select: { id: true, email: true, firstName: true, locale: true } } },
            },
          },
        },
      },
      distinct: ['invoiceId'],
    });

    // Group by owner to send one email per owner
    const byOwner = new Map<string, typeof overdueItems>();
    for (const item of overdueItems) {
      const owner = item.unit.ownerships[0]?.owner;
      if (!owner) continue;
      const existing = byOwner.get(owner.id) ?? [];
      existing.push(item);
      byOwner.set(owner.id, existing);
    }

    for (const [, items] of byOwner) {
      const owner = items[0].unit.ownerships[0]?.owner;
      if (!owner) continue;
      const total = items.reduce((s, i) => s + Number(i.amount), 0);
      const locale = owner.locale === 'en' ? 'en' : 'es';

      await sendEmail({
        to: owner.email,
        template: 'overdueReminder',
        vars: {
          firstName: owner.firstName,
          count: items.length,
          total: total.toFixed(2),
        },
        locale,
      }).catch(() => {}); // fire-and-forget, never throw
    }
  } catch (e) {
    console.error('[scheduler] overdue check failed:', e);
  }
}
