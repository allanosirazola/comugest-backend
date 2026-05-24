import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../config/prisma';
import {
  listNotifications,
  markRead,
  markAllRead,
  createNotification,
  createNotificationsForCommunity,
} from '../modules/notifications/notifications.service';

// Cast to any: vi.mocked doesn't penetrate Prisma's generated client types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notif-1',
    userId: 'user-1',
    title: 'Test notification',
    body: 'Something happened',
    url: '/dashboard',
    readAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── listNotifications ──────────────────────────────────────

describe('listNotifications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries notifications by userId', async () => {
    mockPrisma.notification.findMany.mockResolvedValueOnce([]);
    await listNotifications('user-1');
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
      })
    );
  });

  it('returns notifications for user', async () => {
    const notifications = [makeNotification(), makeNotification({ id: 'notif-2' })];
    mockPrisma.notification.findMany.mockResolvedValueOnce(notifications as any);
    const result = await listNotifications('user-1');
    expect(result).toHaveLength(2);
  });

  it('returns at most 50 notifications (take: 50)', async () => {
    mockPrisma.notification.findMany.mockResolvedValueOnce([]);
    await listNotifications('user-1');
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it('orders by createdAt descending', async () => {
    mockPrisma.notification.findMany.mockResolvedValueOnce([]);
    await listNotifications('user-1');
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
  });
});

// ─── markRead ────────────────────────────────────────────────

describe('markRead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates notification with readAt timestamp', async () => {
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 1 });
    await markRead('user-1', 'notif-1');
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'notif-1', userId: 'user-1' },
      data: { readAt: expect.any(Date) },
    });
  });

  it('scopes update to the correct userId (prevents cross-user access)', async () => {
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 0 });
    await markRead('user-2', 'notif-1');
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-2' }),
      })
    );
  });

  it('returns update result', async () => {
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 1 });
    const result = await markRead('user-1', 'notif-1');
    expect(result).toEqual({ count: 1 });
  });
});

// ─── markAllRead ─────────────────────────────────────────────

describe('markAllRead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates all unread notifications for user', async () => {
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 5 });
    await markAllRead('user-1');
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it('filters only unread notifications (readAt: null)', async () => {
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 0 });
    await markAllRead('user-1');
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ readAt: null }),
      })
    );
  });
});

// ─── createNotification ──────────────────────────────────────

describe('createNotification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates notification with correct fields', async () => {
    const notification = makeNotification();
    mockPrisma.notification.create.mockResolvedValueOnce(notification as any);

    await createNotification('user-1', {
      title: 'Test notification',
      body: 'Something happened',
      url: '/dashboard',
    });

    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        title: 'Test notification',
        body: 'Something happened',
        url: '/dashboard',
      },
    });
  });

  it('creates notification without optional url', async () => {
    const notification = makeNotification({ url: undefined });
    mockPrisma.notification.create.mockResolvedValueOnce(notification as any);

    await createNotification('user-1', {
      title: 'Alert',
      body: 'Your payment was received',
    });

    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        title: 'Alert',
        body: 'Your payment was received',
      },
    });
  });

  it('returns created notification', async () => {
    const notification = makeNotification({ id: 'notif-new' });
    mockPrisma.notification.create.mockResolvedValueOnce(notification as any);

    const result = await createNotification('user-1', {
      title: 'Test',
      body: 'Test body',
    });
    expect(result.id).toBe('notif-new');
  });
});

// ─── createNotificationsForCommunity ─────────────────────────

describe('createNotificationsForCommunity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing when no members or admins exist', async () => {
    // We re-mock communityAdmin on the prisma object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prismaMock = mockPrisma as any;
    prismaMock.communityAdmin.findMany = vi.fn().mockResolvedValueOnce([]);
    prismaMock.ownership.findMany = vi.fn().mockResolvedValueOnce([]);
    prismaMock.notification.createMany = vi.fn();

    await createNotificationsForCommunity('comm-1', { title: 'Test', body: 'Body' });
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('creates notifications for all unique members', async () => {
    const prismaMock = mockPrisma as any;
    prismaMock.ownership.findMany = vi.fn().mockResolvedValueOnce([
      { ownerId: 'user-a' },
      { ownerId: 'user-b' },
    ]);
    prismaMock.communityAdmin.findMany = vi.fn().mockResolvedValueOnce([]);
    prismaMock.notification.createMany = vi.fn().mockResolvedValueOnce({ count: 2 });

    await createNotificationsForCommunity('comm-1', { title: 'Announcement', body: 'Hello all' });
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 'user-a', title: 'Announcement' }),
          expect.objectContaining({ userId: 'user-b', title: 'Announcement' }),
        ]),
      })
    );
  });
});
