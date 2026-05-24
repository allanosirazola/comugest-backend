import { Router } from 'express';
import * as controller from './incidents.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Nested under /communities/:communityId/incidents
export const incidentsRouter: Router = Router({ mergeParams: true });
incidentsRouter.use(authenticate);
incidentsRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));
incidentsRouter.get('/', asyncHandler(controller.listIncidents));
incidentsRouter.post('/', asyncHandler(controller.createIncident));
incidentsRouter.patch('/:incidentId/status', asyncHandler(controller.updateIncidentStatus));
incidentsRouter.post('/:incidentId/photos', asyncHandler(controller.addPhoto));
incidentsRouter.delete('/:incidentId/photos/:photoIndex', asyncHandler(controller.removePhoto));
