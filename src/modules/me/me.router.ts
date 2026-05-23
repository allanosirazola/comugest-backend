import { Router } from 'express';
import * as controller from './me.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate } from '../../middleware/auth.middleware';
import { prisma } from '../../config/prisma';

export const meProfileRouter: Router = Router();
meProfileRouter.use(authenticate);
meProfileRouter.get('/profile', asyncHandler(controller.getProfile));
meProfileRouter.patch('/profile', asyncHandler(controller.updateProfile));
meProfileRouter.post('/profile/change-password', asyncHandler(controller.changePassword));

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
