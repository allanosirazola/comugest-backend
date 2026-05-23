import type { Request, Response, NextFunction } from 'express';
import { CreateMeterReadingSchema } from './meter-readings.schemas';
import * as service from './meter-readings.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const readings = await service.listReadings(
      req.params.communityId as string,
      req.query.unitId as string | undefined,
      req.query.type as string | undefined,
    );
    res.json(readings);
  } catch (e) { next(e); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const input = CreateMeterReadingSchema.parse(req.body);
    const reading = await service.createReading(req.user!.id, req.user!.role, req.params.communityId as string, input);
    res.status(201).json(reading);
  } catch (e) { next(e); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteReading(req.user!.id, req.user!.role, req.params.id as string);
    res.status(204).end();
  } catch (e) { next(e); }
}
