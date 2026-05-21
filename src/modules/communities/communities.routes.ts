import { Router } from 'express';
import * as controller from './communities.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// /me/communities — comunidades del propio usuario (cualquier rol autenticado)
export const meCommunitiesRouter: Router = Router();
meCommunitiesRouter.use(authenticate);
meCommunitiesRouter.get('/communities', asyncHandler(controller.mine));

const router = Router();

router.use(authenticate);
// CRUD reservado a admins de fincas (y support)
router.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));

router.post('/', asyncHandler(controller.create));
router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.getOne));
router.patch('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

export default router;
