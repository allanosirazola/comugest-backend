import type { Request, Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../utils/errors';
import * as svc from './unit-notes.service';

export async function list(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  const { unitId } = z.object({ unitId: z.string().cuid() }).parse(req.params);
  const notes = await svc.listNotes(unitId);
  res.json({ notes });
}

export async function create(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  const { unitId } = z.object({ unitId: z.string().cuid() }).parse(req.params);
  const { content } = z.object({ content: z.string().min(1).max(1000) }).parse(req.body);
  const note = await svc.addNote(unitId, req.user.id, content);
  res.status(201).json({ note });
}

export async function remove(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  const { noteId } = z.object({ unitId: z.string().cuid(), noteId: z.string().cuid() }).parse(req.params);
  await svc.deleteNote(noteId, req.user.id);
  res.status(204).send();
}
