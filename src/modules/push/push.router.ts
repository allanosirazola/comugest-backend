import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { env } from '../../config/env';
import * as service from './push.service';

export const pushRouter = Router();

pushRouter.get('/vapid-key', (_req, res) => {
  res.json({ publicKey: env.VAPID_PUBLIC_KEY });
});

pushRouter.post('/subscribe', authenticate, async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };
    await service.saveSubscription(req.user!.id, { endpoint, keys });
    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

pushRouter.delete('/subscribe', authenticate, async (req, res, next) => {
  try {
    const { endpoint } = req.body as { endpoint: string };
    await service.deleteSubscription(endpoint);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
