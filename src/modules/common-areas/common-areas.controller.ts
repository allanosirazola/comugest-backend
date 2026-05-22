import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './common-areas.service';
import { createAreaSchema, updateAreaSchema, createReservationSchema } from './common-areas.schemas';
import { UnauthorizedError, ValidationError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

// ─── Areas ──────────────────────────────────────────────────────────────────

export async function listAreas(req: Request, res: Response): Promise<void> {
  requireUser(req);
  const { communityId } = z.object({ communityId: z.string() }).parse(req.params);
  const areas = await service.listAreas(communityId);
  res.json({ areas });
}

export async function createArea(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string() }).parse(req.params);
  const input = createAreaSchema.parse(req.body);
  const area = await service.createArea(user.id, communityId, input);
  res.status(201).json({ area });
}

export async function updateArea(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const input = updateAreaSchema.parse(req.body);
  const area = await service.updateArea(user.id, id, input);
  res.json({ area });
}

export async function deleteArea(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string() }).parse(req.params);
  await service.deleteArea(user.id, id);
  res.status(204).send();
}

// ─── Reservations ────────────────────────────────────────────────────────────

export async function listReservations(req: Request, res: Response): Promise<void> {
  requireUser(req);
  const { areaId } = z.object({ areaId: z.string() }).parse(req.params);
  const parsed = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(req.query);
  if (!parsed.success) throw new ValidationError('El parámetro date (YYYY-MM-DD) es requerido');
  const reservations = await service.listReservations(areaId, parsed.data.date);
  res.json({ reservations });
}

export async function createReservation(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = z.object({ communityId: z.string() }).parse(req.params);
  const { areaId } = z.object({ areaId: z.string() }).parse(req.params);
  // areaId in body takes precedence per schema; also inject from params if body lacks it
  const body = { areaId, ...req.body };
  const input = createReservationSchema.parse(body);
  const reservation = await service.createReservation(user.id, communityId, input);
  res.status(201).json({ reservation });
}

export async function cancelReservation(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const isAdmin = user.role === 'ADMIN_FINCAS' || user.role === 'SUPPORT';
  const reservation = await service.cancelReservation(user.id, id, isAdmin);
  res.json({ reservation });
}
