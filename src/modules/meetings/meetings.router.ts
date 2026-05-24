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
// POST /api/v1/meetings/:id/minutes/sign — sign minutes with TOTP (admin)
meetingsRouter.post('/:id/minutes/sign', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.signMinutes));
// GET /api/v1/meetings/:id/minutes/pdf — export minutes as PDF
meetingsRouter.get('/:id/minutes/pdf', authenticate, asyncHandler(controller.exportMinutesPdf));
// GET /api/v1/meetings/:id/convocatoria — export meeting notice as PDF
meetingsRouter.get('/:id/convocatoria', authenticate, requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.exportConvocatoria));

// QR check-in
meetingsRouter.post('/:id/qr-token', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.generateQr));
meetingsRouter.post('/qr-check-in/:token', asyncHandler(controller.qrCheckIn));

// Vecino: /me/meetings
export const meMeetingsRouter: Router = Router();
meMeetingsRouter.use(authenticate);
meMeetingsRouter.get('/meetings', asyncHandler(controller.listMyMeetings));

export default meetingsRouter;
