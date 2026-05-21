import type { Request, Response } from 'express';
import * as service from './units.service';
import {
  createUnitSchema,
  updateUnitSchema,
  unitIdParamSchema,
  communityIdParamSchema,
} from './units.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = communityIdParamSchema.parse(req.params);
  const units = await service.listUnits(user.id, user.role, communityId);
  res.json({ units });
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = communityIdParamSchema.parse(req.params);
  const input = createUnitSchema.parse(req.body);
  const unit = await service.createUnit(user.id, user.role, communityId, input);
  res.status(201).json({ unit });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = unitIdParamSchema.parse(req.params);
  const input = updateUnitSchema.parse(req.body);
  const unit = await service.updateUnit(user.id, user.role, id, input);
  res.json({ unit });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = unitIdParamSchema.parse(req.params);
  await service.deleteUnit(user.id, user.role, id);
  res.status(204).send();
}
