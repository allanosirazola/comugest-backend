import { z } from 'zod';

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(5000).trim(),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// Vecino inicia/recupera conversación con una de sus comunidades
export const startConversationSchema = z.object({
  communityId: z.string().cuid(),
});
export type StartConversationInput = z.infer<typeof startConversationSchema>;
