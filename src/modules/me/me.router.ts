import { Router } from 'express';
import * as controller from './me.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate } from '../../middleware/auth.middleware';
import { prisma } from '../../config/prisma';
import { setup2FA, verify2FA, disable2FA } from '../auth/auth.service';

export const meProfileRouter: Router = Router();
meProfileRouter.use(authenticate);
meProfileRouter.get('/profile', asyncHandler(controller.getProfile));
meProfileRouter.patch('/profile', asyncHandler(controller.updateProfile));
meProfileRouter.post('/profile/change-password', asyncHandler(controller.changePassword));

meProfileRouter.post('/profile/2fa/setup', asyncHandler(async (req, res, next) => {
  try {
    const result = await setup2FA(req.user!.id);
    res.json(result);
  } catch (e) { next(e); }
}));

meProfileRouter.post('/profile/2fa/verify', asyncHandler(async (req, res, next) => {
  try {
    const { token } = req.body as { token: string };
    const result = await verify2FA(req.user!.id, token);
    res.json(result);
  } catch (e) { next(e); }
}));

meProfileRouter.post('/profile/2fa/disable', asyncHandler(async (req, res, next) => {
  try {
    const { token } = req.body as { token: string };
    await disable2FA(req.user!.id, token);
    res.status(204).end();
  } catch (e) { next(e); }
}));

export const meDocumentsRouter: Router = Router();
meDocumentsRouter.use(authenticate);
meDocumentsRouter.get('/documents', asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const communities = await prisma.community.findMany({
    where: {
      units: {
        some: {
          OR: [
            { ownerships: { some: { ownerId: userId } } },
            { occupancies: { some: { occupantId: userId } } },
          ],
        },
      },
    },
    select: { id: true },
  });
  const communityIds = communities.map((c: { id: string }) => c.id);
  const docs = await prisma.document.findMany({
    where: { communityId: { in: communityIds }, publicForResidents: true },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      url: true,
      createdAt: true,
      community: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ community: { name: 'asc' } }, { category: 'asc' }, { createdAt: 'desc' }],
  });
  res.json(docs);
}));
