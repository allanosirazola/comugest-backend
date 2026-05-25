import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ctrl from './calendar.controller';
import { generateCommunityIcs } from './ical.service';

export const communityCalendarRouter = Router({ mergeParams: true });

// GET /communities/:communityId/calendar.ics — public, no auth needed for calendar subscriptions
communityCalendarRouter.get('.ics', asyncHandler(async (req, res) => {
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const ics = await generateCommunityIcs(communityId);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
  res.send(ics);
}));

communityCalendarRouter.use(authenticate);
communityCalendarRouter.get('/', asyncHandler(ctrl.communityCalendar));

export const meCalendarRouter = Router();
meCalendarRouter.use(authenticate);
meCalendarRouter.get('/calendar', asyncHandler(ctrl.myCalendar));
