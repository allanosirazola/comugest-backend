import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import * as ctrl from './reports.controller';

export const communityReportsRouter = Router({ mergeParams: true });

communityReportsRouter.use(authenticate);
communityReportsRouter.get('/morosos', requireRole('ADMIN_FINCAS', 'SUPPORT'), ctrl.morosos);
communityReportsRouter.get('/budget', requireRole('ADMIN_FINCAS', 'SUPPORT'), ctrl.budget);
communityReportsRouter.get('/payments', requireRole('ADMIN_FINCAS', 'SUPPORT'), ctrl.payments);
