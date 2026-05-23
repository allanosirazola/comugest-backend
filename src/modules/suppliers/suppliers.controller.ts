import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CreateSupplierSchema, UpdateSupplierSchema } from './suppliers.schemas';
import * as service from './suppliers.service';
import { UnauthorizedError } from '../../utils/errors';

const communityParams = z.object({ communityId: z.string() });
const idParams = z.object({ id: z.string() });

function requireUser(req: Request) {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { communityId } = communityParams.parse(req.params);
    requireUser(req);
    const suppliers = await service.listSuppliers(communityId);
    res.json(suppliers);
  } catch (e) { next(e); }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    requireUser(req);
    const supplier = await service.getSupplier(id);
    res.json(supplier);
  } catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const { communityId } = communityParams.parse(req.params);
    const input = CreateSupplierSchema.parse(req.body);
    const supplier = await service.createSupplier(user.id, user.role, communityId, input);
    res.status(201).json(supplier);
  } catch (e) { next(e); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const input = UpdateSupplierSchema.parse(req.body);
    const supplier = await service.updateSupplier(user.id, user.role, id, input);
    res.json(supplier);
  } catch (e) { next(e); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    await service.deleteSupplier(user.id, user.role, id);
    res.status(204).end();
  } catch (e) { next(e); }
}
