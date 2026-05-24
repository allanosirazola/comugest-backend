import { Router } from 'express';
import * as controller from './templates.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Nested under /communities/:communityId/templates
export const templatesRouter: Router = Router({ mergeParams: true });
templatesRouter.use(authenticate);
templatesRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));
templatesRouter.get('/', asyncHandler(controller.listTemplates));
templatesRouter.post('/', asyncHandler(controller.createTemplate));
templatesRouter.delete('/:templateId', asyncHandler(controller.deleteTemplate));
