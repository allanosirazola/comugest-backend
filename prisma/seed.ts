import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seed inicial: crea un usuario SUPPORT (equipo interno).
 * El registro público solo permite VECINO/ADMIN_FINCAS, así que los usuarios
 * de soporte se crean por este seed (o por otro SUPPORT en el futuro).
 *
 * Credenciales por defecto (CÁMBIALAS en producción):
 *   email:    support@comugest.app
 *   password: Support1234
 */
async function main(): Promise<void> {
  const email = process.env.SEED_SUPPORT_EMAIL ?? 'support@comugest.app';
  const password = process.env.SEED_SUPPORT_PASSWORD ?? 'Support1234';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`Usuario SUPPORT ya existe: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: 'Equipo',
      lastName: 'Soporte',
      role: 'SUPPORT',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      gdprAcceptedAt: new Date(),
      gdprVersion: '2025-01-01',
    },
  });

  // eslint-disable-next-line no-console
  console.log(`✅ Usuario SUPPORT creado: ${email} / ${password}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
