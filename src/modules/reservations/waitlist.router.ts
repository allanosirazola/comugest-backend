import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { UnauthorizedError } from '../../utils/errors';
import * as svc from './waitlist.service';

// GET /me/waitlist — list my waitlist entries
// DELETE /me/waitlist/:id — leave waitlist
export const meWaitlistRouter = Router();
meWaitlistRouter.use(authenticate);

meWaitlistRouter.get('/waitlist', asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const entries = await svc.listMyWaitlist(req.user.id);
  res.json({ entries });
}));

meWaitlistRouter.delete('/waitlist/:id', asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  await svc.leaveWaitlist(req.user.id, id);
  res.status(204).send();
}));

// GET /communities/:communityId/areas/:areaId/waitlist — admin: view waitlist
// POST /communities/:communityId/areas/:areaId/waitlist — join waitlist
export const areaWaitlistRouter = Router({ mergeParams: true });
areaWaitlistRouter.use(authenticate);

areaWaitlistRouter.get('/', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(async (req, res) => {
  const { areaId } = z.object({ areaId: z.string().cuid() }).parse(req.params);
  const entries = await svc.listAreaWaitlist(areaId);
  res.json({ entries });
}));

areaWaitlistRouter.post('/', asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const { areaId } = z.object({ areaId: z.string().cuid() }).parse(req.params);
  const { startTime, endTime } = z.object({
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
  }).parse(req.body);
  const entry = await svc.joinWaitlist(req.user.id, areaId, new Date(startTime), new Date(endTime));
  res.status(201).json({ entry });
}));
