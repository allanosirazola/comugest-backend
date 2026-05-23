import { prisma } from '../../config/prisma';
import type { UserRole } from '@prisma/client';
import { assertCommunityAccess } from '../../utils/authz';
import { createInvitation } from '../invitations/invitations.service';

interface CsvRow {
  label: string;
  floor?: string;
  door?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
}

export async function importCsv(
  actorId: string,
  actorRole: UserRole,
  communityId: string,
  rows: CsvRow[]
): Promise<{ created: number; invited: number; errors: string[] }> {
  await assertCommunityAccess(actorId, actorRole, communityId);

  let created = 0;
  let invited = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.label?.trim()) {
      errors.push(`Fila sin etiqueta de unidad — omitida`);
      continue;
    }
    try {
      // Create or find the unit
      const existing = await prisma.unit.findFirst({
        where: { communityId, label: row.label.trim() },
      });

      let unit = existing;
      if (!unit) {
        unit = await prisma.unit.create({
          data: {
            communityId,
            label: row.label.trim(),
            type: 'VIVIENDA',
            floor: row.floor?.trim() || null,
            door: row.door?.trim() || null,
          },
        });
        created++;
      }

      // Send invitation if email provided and unit was just created (no existing owner)
      if (row.ownerEmail?.trim() && !existing) {
        const nameParts = (row.ownerName ?? '').trim().split(' ');
        const firstName = nameParts[0] || 'Propietario';
        const lastName = nameParts.slice(1).join(' ') || '';
        try {
          await createInvitation(actorId, {
            communityId,
            unitId: unit.id,
            email: row.ownerEmail.trim(),
            firstName,
            lastName,
            phone: row.ownerPhone?.trim() || undefined,
            relationType: 'OWNER',
            locale: 'es',
          });
          invited++;
        } catch {
          errors.push(`Invitación fallida para ${row.ownerEmail}: ya tiene cuenta o el correo no es válido`);
        }
      }
    } catch (err: unknown) {
      errors.push(`Error en unidad "${row.label}": ${err instanceof Error ? err.message : 'Error desconocido'}`);
    }
  }

  return { created, invited, errors };
}
