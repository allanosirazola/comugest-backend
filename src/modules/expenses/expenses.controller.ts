import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './expenses.service';
import { createExpenseSchema, updateExpenseSchema, listExpensesQuerySchema } from './expenses.schemas';
import { UnauthorizedError, ValidationError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

// ─── Admin: bajo /communities/:communityId/expenses ─────────

export async function listByCommunity(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const filter = listExpensesQuerySchema.parse(req.query);
  const result = await service.listExpenses(user.id, user.role, communityId, filter);
  res.json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const input = createExpenseSchema.parse(req.body);
  const expense = await service.createExpense(user.id, user.role, communityId, input);
  res.status(201).json({ expense });
}

// ─── Admin: bajo /expenses/:id ──────────────────────────────

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  const input = updateExpenseSchema.parse(req.body);
  const expense = await service.updateExpense(user.id, user.role, id, input);
  res.json({ expense });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string().cuid() }).parse(req.params);
  await service.deleteExpense(user.id, user.role, id);
  res.status(204).send();
}

// ─── Vecino: /me/expenses?communityId= ──────────────────────

export async function mine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const parsed = z.object({ communityId: z.string().cuid() }).safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Falta o es inválido el parámetro communityId');
  const filter = listExpensesQuerySchema.parse(req.query);
  const result = await service.listExpensesForResident(user.id, parsed.data.communityId, filter);
  res.json(result);
}
