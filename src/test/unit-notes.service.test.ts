import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../config/prisma';
import {
  listNotes,
  addNote,
  deleteNote,
} from '../modules/units/unit-notes.service';

// Cast to any: vi.mocked doesn't penetrate Prisma's generated client types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    unitId: 'unit-1',
    authorId: 'user-1',
    content: 'This unit has a leaking pipe',
    createdAt: new Date(),
    author: { firstName: 'Ana', lastName: 'García' },
    ...overrides,
  };
}

// ─── listNotes ───────────────────────────────────────────────

describe('listNotes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries notes by unitId', async () => {
    mockPrisma.unitNote.findMany.mockResolvedValueOnce([]);
    await listNotes('unit-1');
    expect(mockPrisma.unitNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { unitId: 'unit-1' },
      })
    );
  });

  it('returns all notes for the unit', async () => {
    const notes = [makeNote(), makeNote({ id: 'note-2', content: 'Another note' })];
    mockPrisma.unitNote.findMany.mockResolvedValueOnce(notes as any);
    const result = await listNotes('unit-1');
    expect(result).toHaveLength(2);
  });

  it('includes author relation', async () => {
    mockPrisma.unitNote.findMany.mockResolvedValueOnce([]);
    await listNotes('unit-1');
    expect(mockPrisma.unitNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          author: expect.anything(),
        }),
      })
    );
  });

  it('orders by createdAt descending', async () => {
    mockPrisma.unitNote.findMany.mockResolvedValueOnce([]);
    await listNotes('unit-1');
    expect(mockPrisma.unitNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('returns empty array when no notes exist', async () => {
    mockPrisma.unitNote.findMany.mockResolvedValueOnce([]);
    const result = await listNotes('unit-42');
    expect(result).toEqual([]);
  });
});

// ─── addNote ─────────────────────────────────────────────────

describe('addNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates note with unitId, authorId and content', async () => {
    const note = makeNote();
    mockPrisma.unitNote.create.mockResolvedValueOnce(note as any);

    await addNote('unit-1', 'user-1', 'This unit has a leaking pipe');

    expect(mockPrisma.unitNote.create).toHaveBeenCalledWith({
      data: {
        unitId: 'unit-1',
        authorId: 'user-1',
        content: 'This unit has a leaking pipe',
      },
      include: expect.objectContaining({ author: expect.anything() }),
    });
  });

  it('returns the created note', async () => {
    const note = makeNote({ id: 'note-new' });
    mockPrisma.unitNote.create.mockResolvedValueOnce(note as any);

    const result = await addNote('unit-1', 'user-1', 'Some content');
    expect(result.id).toBe('note-new');
  });

  it('includes author in return value', async () => {
    const note = makeNote();
    mockPrisma.unitNote.create.mockResolvedValueOnce(note as any);

    await addNote('unit-1', 'user-1', 'Note content');
    expect(mockPrisma.unitNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ author: expect.anything() }),
      })
    );
  });
});

// ─── deleteNote ──────────────────────────────────────────────

describe('deleteNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes note when authorId matches', async () => {
    mockPrisma.unitNote.deleteMany.mockResolvedValueOnce({ count: 1 });
    await deleteNote('note-1', 'user-1');
    expect(mockPrisma.unitNote.deleteMany).toHaveBeenCalledWith({
      where: { id: 'note-1', authorId: 'user-1' },
    });
  });

  it('uses deleteMany scoped by authorId (silently fails if not author)', async () => {
    // When authorId does not match, deleteMany returns count: 0 without throwing
    mockPrisma.unitNote.deleteMany.mockResolvedValueOnce({ count: 0 });
    // deleteNote uses deleteMany — it won't throw, it just won't delete
    await expect(deleteNote('note-1', 'user-other')).resolves.toBeUndefined();
    expect(mockPrisma.unitNote.deleteMany).toHaveBeenCalledWith({
      where: { id: 'note-1', authorId: 'user-other' },
    });
  });

  it('passes correct noteId to delete', async () => {
    mockPrisma.unitNote.deleteMany.mockResolvedValueOnce({ count: 1 });
    await deleteNote('note-xyz', 'user-1');
    expect(mockPrisma.unitNote.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'note-xyz' }),
      })
    );
  });

  it('calls deleteMany exactly once per call', async () => {
    mockPrisma.unitNote.deleteMany.mockResolvedValueOnce({ count: 1 });
    await deleteNote('note-1', 'user-1');
    expect(mockPrisma.unitNote.deleteMany).toHaveBeenCalledOnce();
  });
});
