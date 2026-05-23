import { Router } from 'express';
import * as controller from './meetings.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Nested under /communities/:communityId/meetings
export const communityMeetingsRouter: Router = Router({ mergeParams: true });
communityMeetingsRouter.use(authenticate);
communityMeetingsRouter.get('/', asyncHandler(controller.list));
communityMeetingsRouter.post('/', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.create));

// Flat under /meetings/:id
export const meetingsRouter: Router = Router();
meetingsRouter.use(authenticate);
meetingsRouter.get('/:id', asyncHandler(controller.get));
meetingsRouter.patch('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.update));
meetingsRouter.patch('/:id/attendance', asyncHandler(controller.updateMyAttendance));
// PUT /api/v1/meetings/:id/minutes — save minutes (admin)
meetingsRouter.put('/:id/minutes', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.saveMinutes));
// PATCH /api/v1/meetings/:id/minutes/publish — toggle published (admin)
meetingsRouter.patch('/:id/minutes/publish', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.publishMinutes));

// Vecino: /me/meetings
export const meMeetingsRouter: Router = Router();
meMeetingsRouter.use(authenticate);
meMeetingsRouter.get('/meetings', asyncHandler(controller.listMyMeetings));

export default meetingsRouter;
