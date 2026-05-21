import { Router } from 'express';
import * as controller from './messages.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate } from '../../middleware/auth.middleware';

// Todas requieren autenticación; el acceso fino se resuelve en el servicio.
const router = Router();
router.use(authenticate);

router.get('/conversations', asyncHandler(controller.listConversations));
router.post('/conversations', asyncHandler(controller.startConversation));
router.get('/conversations/:id/messages', asyncHandler(controller.listMessages));
router.post('/conversations/:id/messages', asyncHandler(controller.sendMessage));

export default router;
