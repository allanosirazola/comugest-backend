import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import * as controller from './audit.controller';

export const auditRouter: Router = Router();
auditRouter.use(authenticate);
auditRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));

// GET /api/v1/admin/audit?communityId=&action=&limit=&cursor=
auditRouter.get('/', asyncHandler(controller.list));
