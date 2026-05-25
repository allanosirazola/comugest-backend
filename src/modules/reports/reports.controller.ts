import type { Request, Response, NextFunction } from 'express';
import * as service from './reports.service';

export async function morosos(req: Request, res: Response, next: NextFunction) {
  try {
    await service.generateMorososReport(req.params.communityId as string, res);
  } catch (e) {
    console.error('Reports error [morosos]:', e);
    next(e);
  }
}

export async function budget(req: Request, res: Response, next: NextFunction) {
  try {
    await service.generateBudgetReport(req.params.communityId as string, res);
  } catch (e) {
    console.error('Reports error [budget]:', e);
    next(e);
  }
}

export async function payments(req: Request, res: Response, next: NextFunction) {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;
    await service.generatePaymentsReport(req.params.communityId as string, from, to, res);
  } catch (e) {
    console.error('Reports error [payments]:', e);
    next(e);
  }
}
