import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { sendEmail } from '../modules/email/email.service';
import { buildFrontendUrl } from '../modules/email/templates';

const REMINDER_INTERVAL_DAYS = 7;

export async function sendPaymentReminders(): Promise<void> {
  const now = new Date();
  const reminderCutoff = new Date(now.getTime() - REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  // InvoiceItem has no status field — find items on overdue invoices
  // that haven't been reminded recently, then skip fully-paid ones in JS.
  const candidates = await prisma.invoiceItem.findMany({
    where: {
      invoice: {
        cancelledAt: null,
        dueDate: { lt: now },
      },
      OR: [
        { reminderSentAt: null },
        { reminderSentAt: { lt: reminderCutoff } },
      ],
    },
    include: {
      invoice: {
        select: {
          concept: true,
          dueDate: true,
          community: { select: { name: true } },
        },
      },
      unit: {
        select: {
          label: true,
          ownerships: {
            where: { endDate: null },
            take: 1,
            include: {
              owner: { select: { firstName: true, email: true, locale: true } },
            },
          },
        },
      },
      payments: { select: { amount: true } },
    },
  });

  let sent = 0;
  let failed = 0;

  for (const item of candidates) {
    // Skip if fully paid
    const paid = item.payments.reduce((acc, p) => acc + Number(p.amount), 0);
    if (Number(item.amount) - paid <= 0.005) continue;

    const ownership = item.unit.ownerships[0];
    if (!ownership) continue;

    const { owner } = ownership;
    const locale = (owner.locale ?? 'es') as 'es' | 'en';
    const dueDate = item.invoice.dueDate.toISOString().split('T')[0];
    const amount = Number(item.amount).toFixed(2);

    try {
      await sendEmail({
        to: owner.email,
        template: 'paymentReminder',
        vars: {
          firstName: owner.firstName,
          communityName: item.invoice.community.name,
          unitLabel: item.unit.label,
          concept: item.invoice.concept,
          amount,
          dueDate,
          viewUrl: buildFrontendUrl('/my-invoices'),
        },
        locale,
      });

      await prisma.invoiceItem.update({
        where: { id: item.id },
        data: { reminderSentAt: now },
      });

      sent++;
    } catch (err) {
      logger.error(`Error sending payment reminder for item ${item.id}: ${String(err)}`);
      failed++;
    }
  }

  logger.info(`Payment reminders job: sent=${sent} failed=${failed} total=${candidates.length}`);
}
