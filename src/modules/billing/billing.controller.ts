import type { Request, Response, NextFunction } from 'express';
import * as service from './billing.service';
import { env } from '../../config/env';

function getFrontendUrl(req: Request): string {
  return env.FRONTEND_URL || req.headers.origin || 'http://localhost:5173';
}

export async function createCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.createCheckoutSession(req.user!.id, getFrontendUrl(req));
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function createPortal(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.createPortalSession(req.user!.id, getFrontendUrl(req));
    res.json(result);
  } catch (e) {
    next(e);
  }
}

export async function getStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const status = await service.getBillingStatus(req.user!.id);
    res.json(status);
  } catch (e) {
    next(e);
  }
}

export async function webhook(req: Request, res: Response, _next: NextFunction) {
  try {
    const sig = req.headers['stripe-signature'] as string;
    await service.handleWebhook(req.body as Buffer, sig);
    res.json({ received: true });
  } catch (e) {
    res.status(400).json({ error: { message: (e as Error).message } });
  }
}
