'use strict';
// Compiled-compatible seed — runs with plain `node` in production (no tsx/ts-node needed)
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_SUPPORT_EMAIL ?? 'support@comugest.app';
  const password = process.env.SEED_SUPPORT_PASSWORD ?? 'Support1234';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
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

  console.log(`✅ Usuario SUPPORT creado: ${email} / ${password}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
