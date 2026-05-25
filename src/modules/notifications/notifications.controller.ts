import type { Request, Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../utils/errors';
import * as svc from './notifications.service';

export async function list(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  const notifications = await svc.listNotifications(req.user.id);
  res.json({ notifications });
}

export async function markOne(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  const { id } = z.object({ id: z.string() }).parse(req.params);
  await svc.markRead(req.user.id, id);
  res.status(204).send();
}

export async function markAll(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  await svc.markAllRead(req.user.id);
  res.status(204).send();
}
