import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import * as ctrl from './billing.controller';

export const billingRouter = Router();

// Webhook must use raw body — mounted BEFORE json middleware in app.ts
billingRouter.post('/webhook', ctrl.webhook);

billingRouter.use(authenticate);
billingRouter.get('/status', ctrl.getStatus);
billingRouter.post('/checkout', ctrl.createCheckout);
billingRouter.post('/portal', ctrl.createPortal);
