import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CreateDocumentSchema, UpdateDocumentSchema } from './documents.schemas';
import * as service from './documents.service';
import { UnauthorizedError } from '../../utils/errors';

const communityParams = z.object({ communityId: z.string() });
const idParams = z.object({ id: z.string() });

function requireUser(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const { communityId } = communityParams.parse(req.params);
    const isAdmin = user.role === 'ADMIN_FINCAS' || user.role === 'SUPPORT';
    const docs = await service.listDocuments(communityId, isAdmin);
    res.json(docs);
  } catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const { communityId } = communityParams.parse(req.params);
    const input = CreateDocumentSchema.parse(req.body);
    const doc = await service.createDocument(user.id, user.role, communityId, input);
    res.status(201).json(doc);
  } catch (e) { next(e); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const input = UpdateDocumentSchema.parse(req.body);
    const doc = await service.updateDocument(user.id, user.role, id, input);
    res.json(doc);
  } catch (e) { next(e); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    await service.deleteDocument(user.id, user.role, id);
    res.status(204).end();
  } catch (e) { next(e); }
}
