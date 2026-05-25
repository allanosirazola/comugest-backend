import { Router } from 'express';
import * as controller from './units.controller';
import * as invoicesController from '../invoices/invoices.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Rutas anidadas: /communities/:communityId/units
export const nestedUnitsRouter: Router = Router({ mergeParams: true });
nestedUnitsRouter.use(authenticate);
nestedUnitsRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));
nestedUnitsRouter.get('/', asyncHandler(controller.list));
nestedUnitsRouter.post('/', asyncHandler(controller.create));
nestedUnitsRouter.get('/:unitId/delinquency', asyncHandler(invoicesController.unitDelinquencyHistory));
nestedUnitsRouter.get('/:unitId/ownership-history', asyncHandler(controller.ownershipHistory));

// Rutas planas: /units/:id (PATCH/DELETE)
const flatRouter: Router = Router();
flatRouter.use(authenticate);
flatRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));
flatRouter.patch('/:id', asyncHandler(controller.update));
flatRouter.delete('/:id', asyncHandler(controller.remove));

export default flatRouter;
