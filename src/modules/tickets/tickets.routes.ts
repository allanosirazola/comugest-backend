import { Router } from 'express';
import * as controller from './tickets.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// /tickets — cualquier usuario autenticado puede crear y ver los suyos
const router = Router();
router.use(authenticate);
router.post('/', asyncHandler(controller.create));
router.get('/:id', asyncHandler(controller.getOne));
router.patch('/:id', requireRole('SUPPORT'), asyncHandler(controller.update));
router.post('/:id/comments', asyncHandler(controller.addComment));

// /me/tickets — mis tickets
export const meTicketsRouter: Router = Router();
meTicketsRouter.use(authenticate);
meTicketsRouter.get('/tickets', asyncHandler(controller.listMine));

// /support — solo SUPPORT
export const supportRouter: Router = Router();
supportRouter.use(authenticate);
supportRouter.use(requireRole('SUPPORT'));
supportRouter.get('/tickets', asyncHandler(controller.listAll));
supportRouter.get('/metrics', asyncHandler(controller.metrics));

export default router;
