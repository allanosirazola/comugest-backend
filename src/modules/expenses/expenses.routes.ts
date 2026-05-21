import { Router } from 'express';
import * as controller from './expenses.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Anidadas bajo /communities/:communityId/expenses (admin)
export const communityExpensesRouter: Router = Router({ mergeParams: true });
communityExpensesRouter.use(authenticate);
communityExpensesRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));
communityExpensesRouter.get('/', asyncHandler(controller.listByCommunity));
communityExpensesRouter.post('/', asyncHandler(controller.create));

// Top-level /expenses/:id (admin)
const expensesRouter = Router();
expensesRouter.use(authenticate);
expensesRouter.patch('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.update));
expensesRouter.delete('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.remove));

// Vecino: /me/expenses?communityId=
export const meExpensesRouter: Router = Router();
meExpensesRouter.use(authenticate);
meExpensesRouter.get('/expenses', asyncHandler(controller.mine));

export default expensesRouter;
