import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './messages.service';
import { sendMessageSchema, startConversationSchema } from './messages.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function listConversations(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const conversations = await service.listConversations(user.id, user.role);
  res.json({ conversations });
}

export async function startConversation(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = startConversationSchema.parse(req.body);
  const conversation = await service.getOrCreateConversation(user.id, communityId);
  res.status(201).json({ conversation });
}

export async function listMessages(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const result = await service.listMessages(user.id, user.role, id);
  res.json(result);
}

export async function sendMessage(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const { body } = sendMessageSchema.parse(req.body);
  const message = await service.sendMessage(user.id, user.role, id, body);
  res.status(201).json({ message });
}
