import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ctrl from './meter-readings.controller';

export const communityMeterReadingsRouter = Router({ mergeParams: true });

communityMeterReadingsRouter.use(authenticate);
communityMeterReadingsRouter.get('/', asyncHandler(ctrl.list));
communityMeterReadingsRouter.post('/', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.create));
communityMeterReadingsRouter.delete('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.remove));
