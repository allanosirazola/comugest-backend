import { Router } from 'express';
import * as controller from './common-areas.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// ─── Nested under /communities/:communityId/areas ────────────────────────────
export const communityAreasRouter: Router = Router({ mergeParams: true });
communityAreasRouter.use(authenticate);

communityAreasRouter.get('/', asyncHandler(controller.listAreas));
communityAreasRouter.post(
  '/',
  requireRole('ADMIN_FINCAS', 'SUPPORT'),
  asyncHandler(controller.createArea)
);
communityAreasRouter.get(
  '/:areaId/reservations',
  asyncHandler(controller.listReservations)
);
communityAreasRouter.post(
  '/:areaId/reservations',
  asyncHandler(controller.createReservation)
);

// ─── Flat under /areas ───────────────────────────────────────────────────────
export const areaActionsRouter: Router = Router();
areaActionsRouter.use(authenticate);

areaActionsRouter.patch(
  '/:id',
  requireRole('ADMIN_FINCAS', 'SUPPORT'),
  asyncHandler(controller.updateArea)
);
areaActionsRouter.delete(
  '/:id',
  requireRole('ADMIN_FINCAS', 'SUPPORT'),
  asyncHandler(controller.deleteArea)
);
areaActionsRouter.delete(
  '/reservations/:id',
  asyncHandler(controller.cancelReservation)
);

// ─── Vecino: /me/reservations ────────────────────────────────
export const meReservationsRouter: Router = Router();
meReservationsRouter.use(authenticate);
meReservationsRouter.get('/reservations', asyncHandler(controller.listMyReservations));
