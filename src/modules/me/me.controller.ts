import type { Request, Response } from 'express';
import * as service from './me.service';
import { updateProfileSchema, changePasswordSchema } from './me.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function getProfile(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const profile = await service.getProfile(user.id);
  res.json({ profile });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = updateProfileSchema.parse(req.body);
  const profile = await service.updateProfile(user.id, input);
  res.json({ profile });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = changePasswordSchema.parse(req.body);
  await service.changePassword(user.id, input);
  res.status(204).send();
}
