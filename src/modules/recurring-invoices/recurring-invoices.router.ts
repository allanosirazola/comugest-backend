import { Router } from 'express';
import * as controller from './recurring-invoices.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Nested under /communities/:communityId/recurring
export const communityRecurringRouter: Router = Router({ mergeParams: true });

communityRecurringRouter.use(authenticate);

communityRecurringRouter.get('/', asyncHandler(controller.list));

communityRecurringRouter.post(
  '/',
  requireRole('ADMIN_FINCAS', 'SUPPORT'),
  asyncHandler(controller.create)
);

communityRecurringRouter.patch(
  '/:id',
  requireRole('ADMIN_FINCAS', 'SUPPORT'),
  asyncHandler(controller.update)
);

communityRecurringRouter.post(
  '/:id/trigger',
  requireRole('ADMIN_FINCAS', 'SUPPORT'),
  asyncHandler(controller.trigger)
);
