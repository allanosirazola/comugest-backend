import type { Request, Response, NextFunction } from 'express';
import { AddCoAdminSchema } from './co-admins.schemas';
import * as service from './co-admins.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const admins = await service.listCoAdmins(req.params.communityId as string);
    res.json(admins);
  } catch (e) {
    next(e);
  }
}

export async function add(req: Request, res: Response, next: NextFunction) {
  try {
    const input = AddCoAdminSchema.parse(req.body);
    const user = await service.addCoAdmin(
      req.user!.id,
      req.user!.role,
      req.params.communityId as string,
      input,
    );
    res.status(201).json(user);
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await service.removeCoAdmin(
      req.user!.id,
      req.user!.role,
      req.params.communityId as string,
      req.params.userId as string,
    );
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}
