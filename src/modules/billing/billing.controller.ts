import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as service from './billing.service';
import { env } from '../../config/env';
import { UnauthorizedError } from '../../utils/errors';
import { asyncHandler } from '../../utils/asyncHandler';

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

export async function invoiceCheckout(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  const { communityId, invoiceId } = z.object({
    communityId: z.string().cuid(),
    invoiceId: z.string().cuid(),
  }).parse(req.params);
  const origin = req.headers.origin ?? 'http://localhost:5173';
  const url = await service.createInvoiceCheckoutSession(
    req.user.id,
    communityId,
    invoiceId,
    `${origin}/mis-facturas?paid=1`,
    `${origin}/mis-facturas`,
  );
  res.json({ url });
}

// re-export asyncHandler so the router can use it without a separate import
export { asyncHandler };
