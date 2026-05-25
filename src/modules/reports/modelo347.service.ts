import { prisma } from '../../config/prisma';
import { assertCommunityAccess } from '../../utils/authz';
import type { UserRole } from '@prisma/client';

function escXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function generateModelo347(
  userId: string,
  userRole: UserRole,
  communityId: string,
  year: number,
): Promise<string> {
  await assertCommunityAccess(userId, userRole, communityId);

  const from = new Date(`${year}-01-01`);
  const to = new Date(`${year + 1}-01-01`);

  const expenses = await prisma.expense.findMany({
    where: {
      communityId,
      expenseDate: { gte: from, lt: to },
      supplierId: { not: null },
    },
    include: { supplierRel: true },
  });

  // Group by supplier
  const bySupplier = new Map<string, { supplier: NonNullable<(typeof expenses)[0]['supplierRel']>; total: number }>();
  for (const e of expenses) {
    if (!e.supplierRel || !e.supplierId) continue;
    const existing = bySupplier.get(e.supplierId) ?? { supplier: e.supplierRel, total: 0 };
    existing.total += Number(e.amount);
    bySupplier.set(e.supplierId, existing);
  }

  // Only include suppliers with > 3005.06 € (legal threshold)
  const relevant = Array.from(bySupplier.values()).filter((s) => s.total > 3005.06);

  const community = await prisma.community.findUniqueOrThrow({
    where: { id: communityId },
    select: { name: true },
  });

  const entries = relevant
    .map(
      ({ supplier, total }) => `
    <Registro>
      <NombreProveedor>${escXml(supplier.name)}</NombreProveedor>
      <CIF>${escXml(supplier.cif ?? 'DESCONOCIDO')}</CIF>
      <ImporteTotal>${total.toFixed(2)}</ImporteTotal>
      <Año>${year}</Año>
    </Registro>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Modelo347 xmlns="https://comugest.app/modelo347">
  <Comunidad>${escXml(community.name)}</Comunidad>
  <Ejercicio>${year}</Ejercicio>
  <FechaGeneracion>${new Date().toISOString()}</FechaGeneracion>
  <Operaciones>${relevant.length}</Operaciones>
  ${entries}
</Modelo347>`;
}
