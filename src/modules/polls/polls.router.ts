import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import * as ctrl from './polls.controller';

// Nested under /meetings/:meetingId/polls
export const meetingPollsRouter: Router = Router({ mergeParams: true });

meetingPollsRouter.use(authenticate);
meetingPollsRouter.get('/', ctrl.list);
meetingPollsRouter.post('/', requireRole('ADMIN_FINCAS', 'SUPPORT'), ctrl.create);
meetingPollsRouter.post('/:pollId/close', requireRole('ADMIN_FINCAS', 'SUPPORT'), ctrl.close);
meetingPollsRouter.post('/:pollId/vote', ctrl.vote);
