import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as service from './polls.service';
import { CreatePollSchema, CastVoteSchema } from './polls.schemas';
import { UnauthorizedError } from '../../utils/errors';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = requireUser(req);
    const { meetingId } = z.object({ meetingId: z.string().cuid() }).parse(req.params);
    const polls = await service.listPolls(meetingId, user.id);
    res.json({ polls });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = requireUser(req);
    const { meetingId } = z.object({ meetingId: z.string().cuid() }).parse(req.params);
    const input = CreatePollSchema.parse(req.body);
    const poll = await service.createPoll(user.id, user.role, meetingId, input);
    res.status(201).json({ poll });
  } catch (err) {
    next(err);
  }
}

export async function close(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = requireUser(req);
    const { pollId } = z.object({ pollId: z.string().cuid() }).parse(req.params);
    const poll = await service.closePoll(user.id, user.role, pollId);
    res.json({ poll });
  } catch (err) {
    next(err);
  }
}

export async function vote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = requireUser(req);
    const { pollId } = z.object({ pollId: z.string().cuid() }).parse(req.params);
    const input = CastVoteSchema.parse(req.body);
    const result = await service.castVote(user.id, pollId, input);
    res.json({ vote: result });
  } catch (err) {
    next(err);
  }
}
