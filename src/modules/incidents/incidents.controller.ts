import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './incidents.service';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

const communityIdParam = z.object({ communityId: z.string().cuid() });
const incidentParams = z.object({ communityId: z.string().cuid(), incidentId: z.string().cuid() });

const createIncidentSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  category: z.string().optional(),
  photos: z.array(z.string()).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  resolution: z.string().optional(),
});

const addPhotoSchema = z.object({
  dataUri: z.string().min(1),
});

const photoIndexParam = z.object({
  communityId: z.string().cuid(),
  incidentId: z.string().cuid(),
  photoIndex: z.coerce.number().int().min(0),
});

export async function listIncidents(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = communityIdParam.parse(req.params);
  const incidents = await service.listIncidents(user.id, user.role, communityId);
  res.json({ incidents });
}

export async function createIncident(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = communityIdParam.parse(req.params);
  const input = createIncidentSchema.parse(req.body);
  const incident = await service.createIncident(user.id, user.role, communityId, input);
  res.status(201).json({ incident });
}

export async function updateIncidentStatus(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId, incidentId } = incidentParams.parse(req.params);
  const input = updateStatusSchema.parse(req.body);
  const incident = await service.updateIncidentStatus(user.id, user.role, communityId, incidentId, input);
  res.json({ incident });
}

export async function addPhoto(req: Request, res: Response): Promise<void> {
  requireUser(req);
  const { incidentId } = incidentParams.parse(req.params);
  const { dataUri } = addPhotoSchema.parse(req.body);
  const incident = await service.addIncidentPhoto(incidentId, dataUri);
  res.status(201).json({ incident });
}

export async function removePhoto(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId, incidentId, photoIndex } = photoIndexParam.parse(req.params);
  const incident = await service.removeIncidentPhoto(incidentId, photoIndex, user.id, user.role, communityId);
  res.json({ incident });
}
