import { vi } from 'vitest';

// Set up environment variables needed by config/env.ts before any imports
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-chars-long!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars-long!!';
process.env.NODE_ENV = 'test';

// Mock prisma globally
vi.mock('../config/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    community: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    unit: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    invoice: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    invoiceItem: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    payment: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    ownership: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    occupancy: {
      findMany: vi.fn(),
    },
    meeting: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    budget: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    budgetLine: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    expense: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    announcement: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    notification: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    incidentLog: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    messageTemplate: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    unitNote: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    communityAdmin: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    verificationToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock audit service to avoid side-effects
vi.mock('../modules/audit/audit.service', () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

// Mock email service to avoid actual email sending
vi.mock('../modules/email/email.service', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// Mock push service
vi.mock('../modules/push/push.service', () => ({
  sendToUser: vi.fn().mockResolvedValue(undefined),
}));
