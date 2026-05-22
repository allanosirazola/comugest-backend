import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import * as controller from './admin.controller';

export const adminRouter: Router = Router();
adminRouter.use(authenticate);
adminRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));

adminRouter.get('/kpis', asyncHandler(controller.kpis));
