import { Router } from 'express';
import * as controller from './budgets.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Nested under /communities/:communityId/budgets/:year
export const communityBudgetsRouter: Router = Router({ mergeParams: true });
communityBudgetsRouter.use(authenticate);
communityBudgetsRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));
communityBudgetsRouter.get('/:year', asyncHandler(controller.getSummary));
communityBudgetsRouter.put('/:year', asyncHandler(controller.upsert));
