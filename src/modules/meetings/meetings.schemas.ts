import { z } from 'zod';

export const createMeetingSchema = z.object({
  title: z.string().min(1),
  type: z.enum(['ORDINARY', 'EXTRAORDINARY']).default('ORDINARY'),
  scheduledAt: z.coerce.date(),
  location: z.string().optional(),
  agenda: z.string().optional(),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export const updateMeetingSchema = z.object({
  title: z.string().min(1).optional(),
  type: z.enum(['ORDINARY', 'EXTRAORDINARY']).optional(),
  scheduledAt: z.coerce.date().optional(),
  location: z.string().optional(),
  agenda: z.string().optional(),
  status: z.enum(['SCHEDULED', 'HELD', 'CANCELLED']).optional(),
  minutes: z.string().optional(),
  minutesUrl: z.string().optional(),
});
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

export const updateAttendanceSchema = z
  .object({
    status: z.enum(['PENDING', 'CONFIRMED', 'DECLINED', 'DELEGATED']),
    proxy: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.status === 'DELEGATED') {
        return typeof data.proxy === 'string' && data.proxy.trim().length > 0;
      }
      return true;
    },
    { message: 'proxy es obligatorio cuando el estado es DELEGATED', path: ['proxy'] }
  );
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;
