/**
 * E2E test setup — configures environment variables for the real test database.
 * Runs before all E2E tests. No Prisma mocks; uses comugest_test PostgreSQL DB.
 */

// Set environment variables BEFORE any modules are imported.
// These override whatever is in the .env (or .env.test) on disk.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://comugest:comugest@localhost:5432/comugest_test?schema=public';
process.env.JWT_ACCESS_SECRET = 'e2e-test-access-secret-at-least-32-chars-long!!';
process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret-at-least-32-chars-long!!';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';
process.env.BCRYPT_ROUNDS = '4'; // Minimum for speed in tests
process.env.EMAIL_PROVIDER = 'console'; // Don't send real emails
process.env.STRIPE_SECRET_KEY = '';
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';
process.env.PORT = '4001'; // Different from dev server

import { beforeAll, afterAll } from 'vitest';
import { prisma } from '../../config/prisma';

/**
 * Wipe all data from the test database in dependency order.
 * Re-runs before every test suite to guarantee isolation.
 */
export async function resetDatabase() {
  // Delete in reverse dependency order to avoid FK violations
  const tableNames = [
    'Payment',
    'InvoiceItem',
    'Invoice',
    'Expense',
    'BudgetItem',
    'Budget',
    'Reservation',
    'CommonArea',
    'Incident',
    'IncidentLog',
    'Message',
    'Conversation',
    'Announcement',
    'Procedure',
    'Document',
    'MeetingMinute',
    'Meeting',
    'UnitNote',
    'MeterReading',
    'Meter',
    'RecurringInvoice',
    'Supplier',
    'DelinquencyRecord',
    'Occupancy',
    'Ownership',
    'Unit',
    'CommunityAdmin',
    'Community',
    'Notification',
    'PushSubscription',
    'RefreshToken',
    'PasswordReset',
    'EmailVerification',
    'MessageTemplate',
    'CustomFieldDefinition',
    'NotificationPreference',
    'User',
  ];

  for (const table of tableNames) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any)[table.charAt(0).toLowerCase() + table.slice(1)]?.deleteMany();
    } catch {
      // Some tables might not exist yet — ignore
    }
  }
}

beforeAll(async () => {
  await prisma.$connect();
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});
