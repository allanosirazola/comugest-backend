import type { Request, Response } from 'express';
import * as service from './admin.service';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function kpis(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const data = await service.getAdminKpis(user.id, user.role);
  res.json(data);
}
