import { logger } from '../config/logger';
import { sendPaymentReminders } from './sendPaymentReminders';
import { processAllDue } from '../modules/recurring-invoices/recurring-invoices.service';

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export function startJobs(): void {
  // Run once at startup (after a short delay so DB is ready), then every 24h
  setTimeout(() => {
    void sendPaymentReminders().catch((err: unknown) =>
      logger.error(`Initial payment reminders run failed: ${String(err)}`)
    );
    void processAllDue().catch((err: unknown) =>
      logger.error(`Initial recurring invoices run failed: ${String(err)}`)
    );
    setInterval(() => {
      void sendPaymentReminders().catch((err: unknown) =>
        logger.error(`Payment reminders job failed: ${String(err)}`)
      );
      void processAllDue().catch((err: unknown) =>
        logger.error(`Recurring invoices job failed: ${String(err)}`)
      );
    }, TWENTY_FOUR_HOURS);
  }, 30_000);

  logger.info('Background jobs scheduled');
}
