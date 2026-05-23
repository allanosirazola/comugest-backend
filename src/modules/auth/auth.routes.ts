import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from './auth.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos. Inténtalo más tarde.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

const verificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 5, // máximo 5 reenvíos por hora
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Has solicitado demasiados emails. Espera un poco.' } },
});

router.post('/register', authLimiter, asyncHandler(authController.register));
router.post('/login', authLimiter, asyncHandler(authController.login));
router.post('/login/2fa', authLimiter, asyncHandler(authController.twoFactorLogin));
router.post('/verify-email', authLimiter, asyncHandler(authController.verifyEmail));
router.post('/resend-verification', verificationLimiter, asyncHandler(authController.resendVerification));
router.post('/forgot-password', verificationLimiter, asyncHandler(authController.forgotPassword));
router.post('/reset-password', authLimiter, asyncHandler(authController.resetPassword));
router.post('/refresh', asyncHandler(authController.refresh));
router.post('/logout', asyncHandler(authController.logout));
router.get('/me', authenticate, asyncHandler(authController.me));

export default router;
