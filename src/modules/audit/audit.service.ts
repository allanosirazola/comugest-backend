import { type AuditAction } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';

interface AuditParams {
  action: AuditAction;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  communityId?: string;
  meta?: Record<string, unknown>;
}

export async function audit(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: params.action,
        actorId: params.actorId ?? null,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        communityId: params.communityId ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        meta: params.meta ? (params.meta as any) : undefined,
      },
    });
  } catch (err) {
    // Audit failures must never break the main flow
    logger.error(`Audit log write failed [${params.action}]: ${String(err)}`);
  }
}
