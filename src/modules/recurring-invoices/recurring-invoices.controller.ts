import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './recurring-invoices.service';
import { createRecurringSchema, updateRecurringSchema } from './recurring-invoices.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

const communityParams = z.object({
  communityId: z.string().cuid(),
});

const idParams = z.object({
  id: z.string().cuid(),
});

export async function list(req: Request, res: Response): Promise<void> {
  const { communityId } = communityParams.parse(req.params);
  const result = await service.listRecurring(communityId);
  res.json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = communityParams.parse(req.params);
  const input = createRecurringSchema.parse(req.body);
  const recurring = await service.createRecurring(user.id, user.role, communityId, input);
  res.status(201).json(recurring);
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = idParams.parse(req.params);
  const input = updateRecurringSchema.parse(req.body);
  const recurring = await service.updateRecurring(user.id, user.role, id, input);
  res.json(recurring);
}

export async function trigger(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = idParams.parse(req.params);
  const invoice = await service.triggerRecurring(id, user.id);
  res.status(201).json(invoice);
}
