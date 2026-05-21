import { Router } from 'express';
import * as invitationsController from './invitations.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

const router = Router();

// Crear invitación — solo admin de fincas (y support)
router.post(
  '/',
  authenticate,
  requireRole('ADMIN_FINCAS', 'SUPPORT'),
  asyncHandler(invitationsController.create)
);

// Endpoints públicos para el invitado
router.get('/inspect', asyncHandler(invitationsController.inspect));
router.post('/accept', asyncHandler(invitationsController.accept));

export default router;
