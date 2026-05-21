import { z } from 'zod';

export const createInvitationSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  firstName: z.string().min(1).max(80).trim(),
  lastName: z.string().min(1).max(80).trim(),
  phone: z.string().max(30).optional(),
  communityId: z.string().cuid(),
  // Tipo de relación con la unidad
  // OWNER: propietario, OCCUPANT: inquilino, BOTH: propietario que reside
  relationType: z.enum(['OWNER', 'OCCUPANT', 'BOTH']),
  unitId: z.string().cuid(),
  locale: z.enum(['es', 'en']).default('es'),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const acceptInvitationSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(10)
    .max(128)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/\d/),
  gdprAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar el tratamiento de datos' }),
  }),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export const inspectInvitationSchema = z.object({
  token: z.string().min(1),
});
export type InspectInvitationInput = z.infer<typeof inspectInvitationSchema>;
