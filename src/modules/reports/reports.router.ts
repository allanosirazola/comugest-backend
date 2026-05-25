import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { UnauthorizedError } from '../../utils/errors';
import * as ctrl from './reports.controller';
import { generateModelo347 } from './modelo347.service';

export const communityReportsRouter = Router({ mergeParams: true });

communityReportsRouter.use(authenticate);
communityReportsRouter.get('/morosos', requireRole('ADMIN_FINCAS', 'SUPPORT'), ctrl.morosos);
communityReportsRouter.get('/budget', requireRole('ADMIN_FINCAS', 'SUPPORT'), ctrl.budget);
communityReportsRouter.get('/payments', requireRole('ADMIN_FINCAS', 'SUPPORT'), ctrl.payments);
communityReportsRouter.get('/modelo347', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(async (req, res) => {
  if (!req.user) throw new UnauthorizedError();
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const year = z.coerce.number().int().min(2020).max(2099).parse(req.query['year'] ?? new Date().getFullYear() - 1);
  const xml = await generateModelo347(req.user.id, req.user.role, communityId, year);
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="modelo347-${year}.xml"`);
  res.send(xml);
}));
