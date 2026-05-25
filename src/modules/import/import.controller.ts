import type { Request, Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../utils/errors';
import * as importService from './import.service';

const rowSchema = z.object({
  label: z.string().min(1),
  floor: z.string().optional(),
  door: z.string().optional(),
  ownerName: z.string().optional(),
  ownerEmail: z.string().email().optional().or(z.literal('')),
  ownerPhone: z.string().optional(),
});

const importSchema = z.object({
  rows: z.array(rowSchema).min(1).max(500),
});

export async function importCsv(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();
  const { communityId } = z.object({ communityId: z.string().cuid() }).parse(req.params);
  const { rows } = importSchema.parse(req.body);
  const result = await importService.importCsv(req.user.id, req.user.role, communityId, rows);
  res.status(201).json(result);
}
