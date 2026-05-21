import { Router } from 'express';
import * as controller from './announcements.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Anidadas bajo /communities/:communityId/announcements (admin)
export const communityAnnouncementsRouter: Router = Router({ mergeParams: true });
communityAnnouncementsRouter.use(authenticate);
communityAnnouncementsRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));
communityAnnouncementsRouter.get('/', asyncHandler(controller.listByCommunity));
communityAnnouncementsRouter.post('/', asyncHandler(controller.create));

// Top-level /announcements/:id (admin) + /me/announcements (vecino)
const announcementsRouter = Router();
announcementsRouter.use(authenticate);
announcementsRouter.patch('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.update));
announcementsRouter.delete('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.remove));

export const meAnnouncementsRouter: Router = Router();
meAnnouncementsRouter.use(authenticate);
meAnnouncementsRouter.get('/announcements', asyncHandler(controller.mine));

export default announcementsRouter;
