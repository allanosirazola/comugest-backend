import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ctrl from './import.controller';

const router = Router({ mergeParams: true });
router.use(authenticate);
router.post('/', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.importCsv));
export default router;
