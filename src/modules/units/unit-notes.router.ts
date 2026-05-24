import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ctrl from './unit-notes.controller';

const router = Router({ mergeParams: true });
router.use(authenticate, requireRole('ADMIN_FINCAS', 'SUPPORT'));
router.get('/', asyncHandler(ctrl.list));
router.post('/', asyncHandler(ctrl.create));
router.delete('/:noteId', asyncHandler(ctrl.remove));
export default router;
