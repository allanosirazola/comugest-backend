import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ctrl from './notifications.controller';

const router = Router();
router.use(authenticate);
router.get('/', asyncHandler(ctrl.list));
router.patch('/read-all', asyncHandler(ctrl.markAll));
router.patch('/:id/read', asyncHandler(ctrl.markOne));
export default router;
