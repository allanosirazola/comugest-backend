import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './templates.service';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

const communityIdParam = z.object({ communityId: z.string().cuid() });

const templateIdParam = z.object({
  communityId: z.string().cuid(),
  templateId: z.string().cuid(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
});

export async function listTemplates(req: Request, res: Response): Promise<void> {
  requireUser(req);
  const { communityId } = communityIdParam.parse(req.params);
  const templates = await service.listTemplates(communityId);
  res.json({ templates });
}

export async function createTemplate(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = communityIdParam.parse(req.params);
  const input = createTemplateSchema.parse(req.body);
  const template = await service.createTemplate(communityId, user.id, input);
  res.status(201).json({ template });
}

export async function deleteTemplate(req: Request, res: Response): Promise<void> {
  requireUser(req);
  const { templateId } = templateIdParam.parse(req.params);
  await service.deleteTemplate(templateId);
  res.status(204).send();
}
