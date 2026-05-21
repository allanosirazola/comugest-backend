import type { Request, Response } from 'express';
import { z } from 'zod';
import * as service from './tickets.service';
import {
  createTicketSchema,
  updateTicketSchema,
  addCommentSchema,
  listTicketsQuerySchema,
} from './tickets.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

const idParam = z.object({ id: z.string().cuid() });

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = createTicketSchema.parse(req.body);
  // Capturamos el user-agent del header si el cliente no lo envía explícito
  if (!input.userAgent) input.userAgent = req.header('user-agent') ?? null;
  const ticket = await service.createTicket(user.id, input);
  res.status(201).json({ ticket });
}

export async function listMine(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const tickets = await service.listMyTickets(user.id);
  res.json({ tickets });
}

export async function listAll(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const filter = listTicketsQuerySchema.parse(req.query);
  const tickets = await service.listAllTickets(user.role, filter);
  res.json({ tickets });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = idParam.parse(req.params);
  const ticket = await service.getTicket(user.id, user.role, id);
  res.json({ ticket });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = idParam.parse(req.params);
  const input = updateTicketSchema.parse(req.body);
  const ticket = await service.updateTicket(user.role, id, input);
  res.json({ ticket });
}

export async function addComment(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = idParam.parse(req.params);
  const input = addCommentSchema.parse(req.body);
  const comment = await service.addComment(user.id, user.role, id, input);
  res.status(201).json({ comment });
}

export async function metrics(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const data = await service.getMetrics(user.role);
  res.json(data);
}
