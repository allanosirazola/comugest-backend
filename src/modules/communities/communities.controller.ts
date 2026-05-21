import type { Request, Response } from 'express';
import * as service from './communities.service';
import {
  createCommunitySchema,
  updateCommunitySchema,
  communityIdParamSchema,
} from './communities.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = createCommunitySchema.parse(req.body);
  const community = await service.createCommunity(user.id, input);
  res.status(201).json({ community });
}

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const communities = await service.listCommunities(user.id, user.role);
  res.json({ communities });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = communityIdParamSchema.parse(req.params);
  const community = await service.getCommunity(user.id, user.role, id);
  res.json({ community });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = communityIdParamSchema.parse(req.params);
  const input = updateCommunitySchema.parse(req.body);
  const community = await service.updateCommunity(user.id, user.role, id, input);
  res.json({ community });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = communityIdParamSchema.parse(req.params);
  await service.deleteCommunity(user.id, user.role, id);
  res.status(204).send();
}

export async function mine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const communities = await service.listMyCommunities(user.id);
  res.json({ communities });
}
