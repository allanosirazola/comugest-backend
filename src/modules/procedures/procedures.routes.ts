import { Router } from 'express';
import * as controller from './procedures.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// /procedures — vecino crea, ambos ven detalle y comentan
const router = Router();
router.use(authenticate);
router.post('/', asyncHandler(controller.create));
router.get('/:id', asyncHandler(controller.getOne));
router.patch('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.update));
router.post('/:id/updates', asyncHandler(controller.addUpdate));

// /me/procedures — mis trámites
export const meProceduresRouter: Router = Router();
meProceduresRouter.use(authenticate);
meProceduresRouter.get('/procedures', asyncHandler(controller.listMine));

// /communities/:communityId/procedures — cola del admin
export const communityProceduresRouter: Router = Router({ mergeParams: true });
communityProceduresRouter.use(authenticate);
communityProceduresRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));
communityProceduresRouter.get('/', asyncHandler(controller.listByCommunity));

export default router;
