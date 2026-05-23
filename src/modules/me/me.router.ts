import { Router } from 'express';
import * as controller from './me.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate } from '../../middleware/auth.middleware';

export const meProfileRouter: Router = Router();
meProfileRouter.use(authenticate);
meProfileRouter.get('/profile', asyncHandler(controller.getProfile));
meProfileRouter.patch('/profile', asyncHandler(controller.updateProfile));
meProfileRouter.post('/profile/change-password', asyncHandler(controller.changePassword));
