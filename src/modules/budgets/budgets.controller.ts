import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './budgets.service';
import { upsertBudgetSchema } from './budgets.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

const communityYearParams = z.object({
  communityId: z.string().cuid(),
  year: z.coerce.number().int().min(2000).max(2100),
});

export async function getSummary(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId, year } = communityYearParams.parse(req.params);
  const summary = await service.getBudgetSummary(user.id, user.role, communityId, year);
  res.json(summary);
}

export async function getComparison(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.query);
  const comparison = await service.getBudgetVsActual(user.id, user.role, communityId, year);
  res.json(comparison);
}

export async function upsert(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId, year } = communityYearParams.parse(req.params);
  const input = upsertBudgetSchema.parse({ year, ...req.body });
  const budget = await service.upsertBudget(user.id, user.role, communityId, input);
  res.json({ budget });
}
