import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './announcements.service';
import { createAnnouncementSchema, updateAnnouncementSchema } from './announcements.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listByCommunity(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const announcements = await service.listCommunityAnnouncements(user.id, user.role, communityId);
  res.json({ announcements });
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const input = createAnnouncementSchema.parse(req.body);
  const announcement = await service.createAnnouncement(user.id, user.role, communityId, input);
  res.status(201).json({ announcement });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const input = updateAnnouncementSchema.parse(req.body);
  const announcement = await service.updateAnnouncement(user.id, user.role, id, input);
  res.json({ announcement });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  await service.deleteAnnouncement(user.id, user.role, id);
  res.status(204).send();
}

export async function mine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const announcements = await service.listMyAnnouncements(user.id);
  res.json({ announcements });
}
