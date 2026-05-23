import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ctrl from './documents.controller';

export const communityDocumentsRouter = Router({ mergeParams: true });

communityDocumentsRouter.use(authenticate);
communityDocumentsRouter.get('/', asyncHandler(ctrl.list));
communityDocumentsRouter.post('/', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.create));
communityDocumentsRouter.patch('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.update));
communityDocumentsRouter.delete('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.remove));
