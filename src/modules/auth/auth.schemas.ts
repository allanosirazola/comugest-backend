import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128)
  .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
  .regex(/[a-z]/, 'Debe contener al menos una minúscula')
  .regex(/\d/, 'Debe contener al menos un número');

export const registerSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: passwordSchema,
  firstName: z.string().min(1).max(80).trim(),
  lastName: z.string().min(1).max(80).trim(),
  phone: z.string().max(30).optional(),
  role: z.enum(['ADMIN_FINCAS']),
  locale: z.enum(['es', 'en']).default('es'),
  gdprAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar el tratamiento de datos para registrarte' }),
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(10, 'La contraseña debe tener al menos 10 caracteres')
    .max(128)
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[a-z]/, 'Debe contener al menos una minúscula')
    .regex(/\d/, 'Debe contener al menos un número'),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const twoFactorLoginSchema = z.object({
  preAuthToken: z.string().min(1),
  totpCode: z.string().length(6).regex(/^\d{6}$/),
});
export type TwoFactorLoginInput = z.infer<typeof twoFactorLoginSchema>;
