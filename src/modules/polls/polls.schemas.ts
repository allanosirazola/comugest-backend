import { z } from 'zod';

export const CreatePollSchema = z.object({
  question: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  votingDeadline: z.coerce.date().optional(),
  requiresAttendance: z.boolean().optional(),
});

export const CastVoteSchema = z.object({
  option: z.enum(['FAVOR', 'CONTRA', 'ABSTENCION']),
});

export type CreatePollInput = z.infer<typeof CreatePollSchema>;
export type CastVoteInput = z.infer<typeof CastVoteSchema>;
