import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './meetings.service';
import { createMeetingSchema, updateMeetingSchema, updateAttendanceSchema } from './meetings.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function list(req: Request, res: Response): Promise<void> {
  requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const meetings = await service.listMeetings(communityId);
  res.json({ meetings });
}

export async function get(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const meeting = await service.getMeeting(id, user.id);
  res.json({ meeting });
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const input = createMeetingSchema.parse(req.body);
  const meeting = await service.createMeeting(user.id, communityId, input);
  res.status(201).json({ meeting });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const input = updateMeetingSchema.parse(req.body);
  const meeting = await service.updateMeeting(user.id, id, input);
  res.json({ meeting });
}

export async function listMyMeetings(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const meetings = await service.listMyMeetings(user.id);
  res.json({ meetings });
}

export async function updateMyAttendance(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const input = updateAttendanceSchema.parse(req.body);
  const attendee = await service.updateAttendance(user.id, id, input);
  res.json({ attendee });
}
