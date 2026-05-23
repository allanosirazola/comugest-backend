import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import * as ctrl from './co-admins.controller';

export const communityCoAdminsRouter = Router({ mergeParams: true });

communityCoAdminsRouter.use(authenticate);

// GET / — any authenticated user can view the admin list
communityCoAdminsRouter.get('/', ctrl.list);

// POST / — only ADMIN_FINCAS or SUPPORT can add a co-admin
communityCoAdminsRouter.post('/', requireRole('ADMIN_FINCAS', 'SUPPORT'), ctrl.add);

// DELETE /:userId — only ADMIN_FINCAS or SUPPORT can remove a co-admin
communityCoAdminsRouter.delete('/:userId', requireRole('ADMIN_FINCAS', 'SUPPORT'), ctrl.remove);
