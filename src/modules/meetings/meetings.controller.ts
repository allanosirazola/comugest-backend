import type { Request, Response } from 'express';
import * as QRCode from 'qrcode';
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

export async function saveMinutes(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const { minutes } = z.object({ minutes: z.string() }).parse(req.body);
  const meeting = await service.saveMinutes(user.id, user.role, id, minutes);
  res.json({ meeting });
}

export async function publishMinutes(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const { published } = z.object({ published: z.boolean() }).parse(req.body);
  const meeting = await service.publishMinutes(user.id, user.role, id, published);
  res.json({ meeting });
}

export async function generateQr(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const result = await service.generateQrToken(user.id, user.role, id);
  const origin = (req.headers.origin as string | undefined) ?? 'https://comugest.app';
  const qrDataUrl = await QRCode.toDataURL(`${origin}${result.url}`);
  res.json({ token: result.token, qrDataUrl, url: result.url });
}

export async function qrCheckIn(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { token } = z.object({ token: z.string() }).parse(req.params);
  await service.checkInWithQr(token, user.id);
  res.status(204).send();
}

export async function signMinutes(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  const id = z.string().cuid().parse(req.params.id);
  const { totpCode } = z.object({ totpCode: z.string().length(6).regex(/^\d{6}$/) }).parse(req.body);
  const meeting = await service.signMinutes(req.user.id, req.user.role, id, totpCode);
  res.json({ meeting });
}

export async function exportMinutesPdf(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  const id = z.string().cuid().parse(req.params.id);
  const pdf = await service.exportMinutesPdf(req.user.id, req.user.role, id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="acta-${id.slice(0, 8)}.pdf"`);
  res.send(pdf);
}
