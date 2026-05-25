import type { Request, Response, NextFunction } from 'express';
import * as service from './calendar.service';

function parseDate(val: unknown, fallback: Date): Date {
  if (typeof val !== 'string') return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

export async function communityCalendar(req: Request, res: Response, next: NextFunction) {
  try {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 3, 0);
    const from = parseDate(req.query.from, defaultFrom);
    const to = parseDate(req.query.to, defaultTo);
    const events = await service.getCommunityCalendar(req.params.communityId as string, from, to);
    res.json(events);
  } catch (e) {
    next(e);
  }
}

export async function myCalendar(req: Request, res: Response, next: NextFunction) {
  try {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 3, 0);
    const from = parseDate(req.query.from, defaultFrom);
    const to = parseDate(req.query.to, defaultTo);
    const events = await service.getMyCalendar(req.user!.id, from, to);
    res.json(events);
  } catch (e) {
    next(e);
  }
}
