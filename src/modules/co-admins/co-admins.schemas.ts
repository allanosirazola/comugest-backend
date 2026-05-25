import { z } from 'zod';

export const AddCoAdminSchema = z.object({
  email: z.string().email(),
});

export type AddCoAdminInput = z.infer<typeof AddCoAdminSchema>;
