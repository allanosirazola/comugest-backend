import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './procedures.service';
import {
  createProcedureSchema,
  updateProcedureSchema,
  addUpdateSchema,
  listProceduresQuerySchema,
} from './procedures.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

const idParam = z.object({ id: z.string().cuid() });

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = createProcedureSchema.parse(req.body);
  const procedure = await service.createProcedure(user.id, input);
  res.status(201).json({ procedure });
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const procedures = await service.listMyProcedures(user.id);
  res.json({ procedures });
}

export async function listByCommunity(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const filter = listProceduresQuerySchema.parse(req.query);
  const procedures = await service.listCommunityProcedures(user.id, user.role, communityId, filter);
  res.json({ procedures });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = idParam.parse(req.params);
  const procedure = await service.getProcedure(user.id, user.role, id);
  res.json({ procedure });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = idParam.parse(req.params);
  const input = updateProcedureSchema.parse(req.body);
  const procedure = await service.updateProcedure(user.id, user.role, id, input);
  res.json({ procedure });
}

export async function addUpdate(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = idParam.parse(req.params);
  const input = addUpdateSchema.parse(req.body);
  const update = await service.addUpdate(user.id, user.role, id, input);
  res.status(201).json({ update });
}
