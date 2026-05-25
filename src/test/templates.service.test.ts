import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../config/prisma';
import {
  listTemplates,
  createTemplate,
  deleteTemplate,
} from '../modules/templates/templates.service';

// Cast to any: vi.mocked doesn't penetrate Prisma's generated client types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    communityId: 'comm-1',
    createdById: 'user-1',
    name: 'Welcome Message',
    subject: 'Welcome to our community',
    body: 'Dear resident, welcome!',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: { firstName: 'Ana', lastName: 'García' },
    ...overrides,
  };
}

// ─── listTemplates ──────────────────────────────────────────

describe('listTemplates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries by communityId', async () => {
    mockPrisma.messageTemplate.findMany.mockResolvedValueOnce([]);
    await listTemplates('comm-1');
    expect(mockPrisma.messageTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { communityId: 'comm-1' },
      })
    );
  });

  it('returns all templates for the community', async () => {
    const templates = [makeTemplate(), makeTemplate({ id: 'tpl-2', name: 'Overdue Notice' })];
    mockPrisma.messageTemplate.findMany.mockResolvedValueOnce(templates as any);
    const result = await listTemplates('comm-1');
    expect(result).toHaveLength(2);
  });

  it('includes createdBy relation', async () => {
    mockPrisma.messageTemplate.findMany.mockResolvedValueOnce([]);
    await listTemplates('comm-1');
    expect(mockPrisma.messageTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          createdBy: expect.anything(),
        }),
      })
    );
  });

  it('returns empty array when no templates exist', async () => {
    mockPrisma.messageTemplate.findMany.mockResolvedValueOnce([]);
    const result = await listTemplates('comm-1');
    expect(result).toEqual([]);
  });

  it('uses different communityId when called with different community', async () => {
    mockPrisma.messageTemplate.findMany.mockResolvedValueOnce([]);
    await listTemplates('comm-99');
    expect(mockPrisma.messageTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { communityId: 'comm-99' } })
    );
  });
});

// ─── createTemplate ─────────────────────────────────────────

describe('createTemplate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates template with correct fields', async () => {
    const created = makeTemplate();
    mockPrisma.messageTemplate.create.mockResolvedValueOnce(created as any);

    const result = await createTemplate('comm-1', 'user-1', {
      name: 'Welcome Message',
      subject: 'Welcome to our community',
      body: 'Dear resident, welcome!',
    });

    expect(mockPrisma.messageTemplate.create).toHaveBeenCalledWith({
      data: {
        name: 'Welcome Message',
        subject: 'Welcome to our community',
        body: 'Dear resident, welcome!',
        communityId: 'comm-1',
        createdById: 'user-1',
      },
    });
    expect(result.name).toBe('Welcome Message');
  });

  it('persists communityId and createdById', async () => {
    const created = makeTemplate({ communityId: 'comm-5', createdById: 'user-42' });
    mockPrisma.messageTemplate.create.mockResolvedValueOnce(created as any);

    await createTemplate('comm-5', 'user-42', {
      name: 'Test',
      subject: 'Test Subject',
      body: 'Test Body',
    });

    expect(mockPrisma.messageTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          communityId: 'comm-5',
          createdById: 'user-42',
        }),
      })
    );
  });

  it('returns the created template', async () => {
    const created = makeTemplate({ id: 'tpl-new' });
    mockPrisma.messageTemplate.create.mockResolvedValueOnce(created as any);

    const result = await createTemplate('comm-1', 'user-1', {
      name: 'Test',
      subject: 'Subject',
      body: 'Body',
    });

    expect(result.id).toBe('tpl-new');
  });
});

// ─── deleteTemplate ─────────────────────────────────────────

describe('deleteTemplate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls prisma.messageTemplate.delete with correct id', async () => {
    mockPrisma.messageTemplate.delete.mockResolvedValueOnce(makeTemplate() as any);
    await deleteTemplate('tpl-1');
    expect(mockPrisma.messageTemplate.delete).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
    });
  });

  it('calls delete exactly once', async () => {
    mockPrisma.messageTemplate.delete.mockResolvedValueOnce(makeTemplate() as any);
    await deleteTemplate('tpl-1');
    expect(mockPrisma.messageTemplate.delete).toHaveBeenCalledOnce();
  });

  it('passes through errors from prisma', async () => {
    mockPrisma.messageTemplate.delete.mockRejectedValueOnce(new Error('Record not found'));
    await expect(deleteTemplate('tpl-nonexistent')).rejects.toThrow('Record not found');
  });
});
