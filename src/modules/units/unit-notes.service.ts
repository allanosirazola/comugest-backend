import { prisma } from '../../config/prisma';

export async function listNotes(unitId: string) {
  return prisma.unitNote.findMany({
    where: { unitId },
    include: { author: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function addNote(unitId: string, authorId: string, content: string) {
  return prisma.unitNote.create({
    data: { unitId, authorId, content },
    include: { author: { select: { firstName: true, lastName: true } } },
  });
}

export async function deleteNote(noteId: string, authorId: string) {
  await prisma.unitNote.deleteMany({ where: { id: noteId, authorId } });
}
