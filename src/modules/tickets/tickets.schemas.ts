import { z } from 'zod';

export const TICKET_CATEGORIES = ['BUG', 'FEATURE_REQUEST', 'QUESTION', 'BILLING', 'OTHER'] as const;
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export const createTicketSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().min(1).max(200).trim(),
  description: z.string().min(1).max(5000).trim(),
  pageUrl: z.string().max(500).optional().nullable(),
  userAgent: z.string().max(500).optional().nullable(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

// Solo SUPPORT puede cambiar estado/prioridad/asignación
export const updateTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignedToId: z.string().cuid().nullable().optional(),
});
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const addCommentSchema = z.object({
  body: z.string().min(1).max(5000).trim(),
  internal: z.boolean().optional().default(false),
});
export type AddCommentInput = z.infer<typeof addCommentSchema>;

export const listTicketsQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;
