import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ctrl from './suppliers.controller';

export const communitySupplierRouter = Router({ mergeParams: true });

communitySupplierRouter.use(authenticate);
communitySupplierRouter.get('/', asyncHandler(ctrl.list));
communitySupplierRouter.get('/:id', asyncHandler(ctrl.get));
communitySupplierRouter.post('/', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.create));
communitySupplierRouter.patch('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.update));
communitySupplierRouter.delete('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.remove));
