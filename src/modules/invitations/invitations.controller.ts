import type { Request, Response } from 'express';
import * as invitationsService from './invitations.service';
import {
  createInvitationSchema,
  acceptInvitationSchema,
  inspectInvitationSchema,
} from './invitations.schemas';
import { UnauthorizedError } from '../../utils/errors';

export async function create(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  const input = createInvitationSchema.parse(req.body);
  const result = await invitationsService.createInvitation(req.user.id, input);
  res.status(201).json(result);
}

export async function inspect(req: Request, res: Response): Promise<void> {
  const { token } = inspectInvitationSchema.parse({ token: req.query.token });
  const result = await invitationsService.inspectInvitation(token);
  res.json(result);
}

export async function accept(req: Request, res: Response): Promise<void> {
  const input = acceptInvitationSchema.parse(req.body);
  const result = await invitationsService.acceptInvitation(input);
  res.status(200).json(result);
}
