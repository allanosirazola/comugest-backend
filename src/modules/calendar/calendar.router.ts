import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ctrl from './calendar.controller';

export const communityCalendarRouter = Router({ mergeParams: true });
communityCalendarRouter.use(authenticate);
communityCalendarRouter.get('/', asyncHandler(ctrl.communityCalendar));

export const meCalendarRouter = Router();
meCalendarRouter.use(authenticate);
meCalendarRouter.get('/calendar', asyncHandler(ctrl.myCalendar));
