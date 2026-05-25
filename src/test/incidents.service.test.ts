import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../config/prisma';
import {
  listIncidents,
  createIncident,
  updateIncidentStatus,
  addIncidentPhoto,
} from '../modules/incidents/incidents.service';
import { ValidationError, NotFoundError } from '../utils/errors';

// Cast to any: vi.mocked doesn't penetrate Prisma's generated client types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

// Helpers to build mock Prisma records
function makeIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    communityId: 'comm-1',
    number: 1,
    title: 'Test incident',
    description: 'Test description',
    category: 'GENERAL',
    status: 'OPEN',
    resolution: null,
    resolvedAt: null,
    photos: [] as string[],
    reportedById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    reportedBy: { firstName: 'Ana', lastName: 'García' },
    ...overrides,
  };
}

// ─── listIncidents ──────────────────────────────────────────

describe('listIncidents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns list of incidents for community', async () => {
    const incidents = [makeIncident(), makeIncident({ id: 'inc-2', number: 2 })];
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.incidentLog.findMany.mockResolvedValueOnce(incidents as any);

    const result = await listIncidents('user-1', 'ADMIN_FINCAS', 'comm-1');
    expect(result).toHaveLength(2);
    expect(mockPrisma.incidentLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { communityId: 'comm-1' },
        orderBy: { number: 'desc' },
      })
    );
  });

  it('returns empty array when no incidents exist', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.incidentLog.findMany.mockResolvedValueOnce([]);
    const result = await listIncidents('user-1', 'ADMIN_FINCAS', 'comm-1');
    expect(result).toEqual([]);
  });

  it('passes correct communityId filter', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-2', userId: 'user-1', createdAt: new Date() });
    mockPrisma.incidentLog.findMany.mockResolvedValueOnce([]);
    await listIncidents('user-1', 'ADMIN_FINCAS', 'comm-2');
    expect(mockPrisma.incidentLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { communityId: 'comm-2' } })
    );
  });
});

// ─── createIncident ─────────────────────────────────────────

describe('createIncident', () => {
  beforeEach(() => vi.clearAllMocks());

  it('auto-assigns correlative number starting at 1 for first incident', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.incidentLog.findFirst.mockResolvedValueOnce(null); // no previous incidents
    const createdIncident = makeIncident({ number: 1 });
    mockPrisma.incidentLog.create.mockResolvedValueOnce(createdIncident as any);

    const result = await createIncident('user-1', 'ADMIN_FINCAS', 'comm-1', {
      title: 'Test incident',
      description: 'Description',
    });
    expect(mockPrisma.incidentLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ number: 1 }),
      })
    );
    expect(result.number).toBe(1);
  });

  it('increments correlative number from last incident', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.incidentLog.findFirst.mockResolvedValueOnce({ number: 5 } as any);
    const createdIncident = makeIncident({ number: 6 });
    mockPrisma.incidentLog.create.mockResolvedValueOnce(createdIncident as any);

    await createIncident('user-1', 'ADMIN_FINCAS', 'comm-1', {
      title: 'Another incident',
      description: 'Another description',
    });
    expect(mockPrisma.incidentLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ number: 6 }),
      })
    );
  });

  it('uses default category GENERAL when no category provided', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.incidentLog.findFirst.mockResolvedValueOnce(null);
    const createdIncident = makeIncident({ category: 'GENERAL' });
    mockPrisma.incidentLog.create.mockResolvedValueOnce(createdIncident as any);

    await createIncident('user-1', 'ADMIN_FINCAS', 'comm-1', {
      title: 'Test',
      description: 'Test',
    });
    expect(mockPrisma.incidentLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: 'GENERAL' }),
      })
    );
  });

  it('uses provided category when supplied', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    mockPrisma.incidentLog.findFirst.mockResolvedValueOnce(null);
    const createdIncident = makeIncident({ category: 'ELECTRICAL' });
    mockPrisma.incidentLog.create.mockResolvedValueOnce(createdIncident as any);

    await createIncident('user-1', 'ADMIN_FINCAS', 'comm-1', {
      title: 'Test',
      description: 'Test',
      category: 'ELECTRICAL',
    });
    expect(mockPrisma.incidentLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: 'ELECTRICAL' }),
      })
    );
  });
});

// ─── updateIncidentStatus ───────────────────────────────────

describe('updateIncidentStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates incident status', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    const updated = makeIncident({ status: 'IN_PROGRESS' });
    mockPrisma.incidentLog.update.mockResolvedValueOnce(updated as any);

    await updateIncidentStatus('user-1', 'ADMIN_FINCAS', 'comm-1', 'inc-1', { status: 'IN_PROGRESS' });
    expect(mockPrisma.incidentLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-1', communityId: 'comm-1' },
        data: expect.objectContaining({ status: 'IN_PROGRESS' }),
      })
    );
  });

  it('sets resolvedAt when status is RESOLVED', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    const updated = makeIncident({ status: 'RESOLVED', resolvedAt: new Date() });
    mockPrisma.incidentLog.update.mockResolvedValueOnce(updated as any);

    await updateIncidentStatus('user-1', 'ADMIN_FINCAS', 'comm-1', 'inc-1', {
      status: 'RESOLVED',
      resolution: 'Fixed the pipe',
    });
    expect(mockPrisma.incidentLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resolvedAt: expect.any(Date) }),
      })
    );
  });

  it('sets resolvedAt when status is CLOSED', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    const updated = makeIncident({ status: 'CLOSED', resolvedAt: new Date() });
    mockPrisma.incidentLog.update.mockResolvedValueOnce(updated as any);

    await updateIncidentStatus('user-1', 'ADMIN_FINCAS', 'comm-1', 'inc-1', { status: 'CLOSED' });
    expect(mockPrisma.incidentLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resolvedAt: expect.any(Date) }),
      })
    );
  });

  it('does NOT set resolvedAt for non-terminal status', async () => {
    mockPrisma.communityAdmin.findUnique.mockResolvedValueOnce({ communityId: 'comm-1', userId: 'user-1', createdAt: new Date() });
    const updated = makeIncident({ status: 'IN_PROGRESS' });
    mockPrisma.incidentLog.update.mockResolvedValueOnce(updated as any);

    await updateIncidentStatus('user-1', 'ADMIN_FINCAS', 'comm-1', 'inc-1', { status: 'IN_PROGRESS' });
    const callData = mockPrisma.incidentLog.update.mock.calls[0][0].data;
    expect(callData.resolvedAt).toBeUndefined();
  });
});

// ─── addIncidentPhoto ────────────────────────────────────────

describe('addIncidentPhoto', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws ValidationError for non-image dataURI', async () => {
    await expect(
      addIncidentPhoto('inc-1', 'data:application/pdf;base64,abc123')
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when data URI does not start with data:image/', async () => {
    await expect(
      addIncidentPhoto('inc-1', 'https://example.com/image.jpg')
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when image exceeds 600KB', async () => {
    // Create a base64 string that decodes to > 600KB
    // 600KB = 614400 bytes. Base64 = 4/3 bytes. Need ~819200 base64 chars
    const bigBase64 = 'A'.repeat(820_000);
    const bigDataUri = `data:image/jpeg;base64,${bigBase64}`;
    await expect(addIncidentPhoto('inc-1', bigDataUri)).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError when incident does not exist', async () => {
    mockPrisma.incidentLog.findUnique.mockResolvedValueOnce(null);
    const validDataUri = `data:image/jpeg;base64,${'A'.repeat(100)}`;
    await expect(addIncidentPhoto('inc-missing', validDataUri)).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when incident already has 5 photos', async () => {
    const incident = makeIncident({ photos: ['p1', 'p2', 'p3', 'p4', 'p5'] });
    mockPrisma.incidentLog.findUnique.mockResolvedValueOnce(incident as any);
    const validDataUri = `data:image/png;base64,${'A'.repeat(100)}`;
    await expect(addIncidentPhoto('inc-1', validDataUri)).rejects.toThrow(ValidationError);
  });

  it('adds photo when all validations pass', async () => {
    const incident = makeIncident({ photos: ['existing-photo'] });
    const updatedIncident = makeIncident({ photos: ['existing-photo', 'new-photo'] });
    mockPrisma.incidentLog.findUnique.mockResolvedValueOnce(incident as any);
    mockPrisma.incidentLog.update.mockResolvedValueOnce(updatedIncident as any);

    const validDataUri = `data:image/jpeg;base64,${'A'.repeat(100)}`;
    const result = await addIncidentPhoto('inc-1', validDataUri);
    expect(mockPrisma.incidentLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-1' },
        data: { photos: ['existing-photo', validDataUri] },
      })
    );
    expect(result).toBeDefined();
  });

  it('accepts up to 4 existing photos (room for one more)', async () => {
    const incident = makeIncident({ photos: ['p1', 'p2', 'p3', 'p4'] });
    const updatedIncident = makeIncident({ photos: ['p1', 'p2', 'p3', 'p4', 'new'] });
    mockPrisma.incidentLog.findUnique.mockResolvedValueOnce(incident as any);
    mockPrisma.incidentLog.update.mockResolvedValueOnce(updatedIncident as any);

    const validDataUri = `data:image/png;base64,${'B'.repeat(100)}`;
    await expect(addIncidentPhoto('inc-1', validDataUri)).resolves.toBeDefined();
  });
});
