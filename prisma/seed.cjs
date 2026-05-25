'use strict';
// Compiled-compatible seed — runs with plain `node` in production (no tsx/ts-node needed)
// IDEMPOTENT: uses upsert / findFirst+skip patterns throughout
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // ─────────────────────────────────────────────────────────────
  // 1. SUPPORT USER (keep existing)
  // ─────────────────────────────────────────────────────────────
  const supportEmail = process.env.SEED_SUPPORT_EMAIL ?? 'support@comugest.app';
  const supportPassword = process.env.SEED_SUPPORT_PASSWORD ?? 'Support1234';

  let supportUser = await prisma.user.findUnique({ where: { email: supportEmail } });
  if (!supportUser) {
    const passwordHash = await bcrypt.hash(supportPassword, 12);
    supportUser = await prisma.user.create({
      data: {
        email: supportEmail,
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
    console.log(`✅ Usuario SUPPORT creado: ${supportEmail} / ${supportPassword}`);
  } else {
    console.log(`ℹ️  Usuario SUPPORT ya existe: ${supportEmail}`);
  }

  // ─────────────────────────────────────────────────────────────
  // 2. DEMO ADMIN (ADMIN_FINCAS)
  // ─────────────────────────────────────────────────────────────
  const adminEmail = 'admin@demo.comugest.app';
  const adminPassword = 'Demo1234!';
  const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  let demoAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!demoAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    demoAdmin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: 'María González',
        lastName: 'Administradora',
        role: 'ADMIN_FINCAS',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        gdprAcceptedAt: new Date(),
        gdprVersion: '2025-01-01',
        planStatus: 'ACTIVE',
        planCurrentPeriodEnd: oneYearFromNow,
      },
    });
    console.log(`✅ Demo Admin creado: ${adminEmail} / ${adminPassword}`);
  } else {
    console.log(`ℹ️  Demo Admin ya existe: ${adminEmail}`);
  }

  // ─────────────────────────────────────────────────────────────
  // 3. DEMO RESIDENTS (VECINO)
  // ─────────────────────────────────────────────────────────────
  const residentDefs = [
    { email: 'ana.garcia@demo.com',       firstName: 'Ana',    lastName: 'García López' },
    { email: 'carlos.martin@demo.com',    firstName: 'Carlos', lastName: 'Martín Ruiz' },
    { email: 'maria.sanchez@demo.com',    firstName: 'María',  lastName: 'Sánchez Pérez' },
    { email: 'jose.fernandez@demo.com',   firstName: 'José',   lastName: 'Fernández Torres' },
    { email: 'lucia.rodriguez@demo.com',  firstName: 'Lucía',  lastName: 'Rodríguez Vega' },
    { email: 'pedro.lopez@demo.com',      firstName: 'Pedro',  lastName: 'López Morales' },
  ];

  const residentPassword = 'Demo1234!';
  const residents = {};

  for (const def of residentDefs) {
    let user = await prisma.user.findUnique({ where: { email: def.email } });
    if (!user) {
      const passwordHash = await bcrypt.hash(residentPassword, 12);
      user = await prisma.user.create({
        data: {
          email: def.email,
          passwordHash,
          firstName: def.firstName,
          lastName: def.lastName,
          role: 'VECINO',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          gdprAcceptedAt: new Date(),
          gdprVersion: '2025-01-01',
        },
      });
      console.log(`✅ Vecino creado: ${def.email}`);
    } else {
      console.log(`ℹ️  Vecino ya existe: ${def.email}`);
    }
    // Store by email shorthand for easy lookup below
    residents[def.email] = user;
  }

  const anaUser     = residents['ana.garcia@demo.com'];
  const carlosUser  = residents['carlos.martin@demo.com'];
  const mariaUser   = residents['maria.sanchez@demo.com'];
  const joseUser    = residents['jose.fernandez@demo.com'];
  const luciaUser   = residents['lucia.rodriguez@demo.com'];
  const pedroUser   = residents['pedro.lopez@demo.com'];

  // ─────────────────────────────────────────────────────────────
  // 4. COMMUNITY 1 — Calle Mayor 15
  // ─────────────────────────────────────────────────────────────
  let comm1 = await prisma.community.findFirst({ where: { cif: 'H28123456' } });
  if (!comm1) {
    comm1 = await prisma.community.create({
      data: {
        name: 'Comunidad Calle Mayor 15',
        address: 'Calle Mayor, 15',
        city: 'Madrid',
        postalCode: '28013',
        country: 'ES',
        cif: 'H28123456',
      },
    });
    console.log(`✅ Comunidad 1 creada: ${comm1.name}`);
  } else {
    console.log(`ℹ️  Comunidad 1 ya existe: ${comm1.name}`);
  }

  // Link demoAdmin as community admin
  await prisma.communityAdmin.upsert({
    where: { communityId_userId: { communityId: comm1.id, userId: demoAdmin.id } },
    create: { communityId: comm1.id, userId: demoAdmin.id },
    update: {},
  });

  // Units for Community 1
  const comm1UnitDefs = [
    { label: '1A', floor: '1', door: 'A',  type: 'VIVIENDA', ownerEmail: 'ana.garcia@demo.com' },
    { label: '1B', floor: '1', door: 'B',  type: 'VIVIENDA', ownerEmail: 'carlos.martin@demo.com' },
    { label: '2A', floor: '2', door: 'A',  type: 'VIVIENDA', ownerEmail: 'maria.sanchez@demo.com' },
    { label: '2B', floor: '2', door: 'B',  type: 'VIVIENDA', ownerEmail: 'jose.fernandez@demo.com' },
    { label: '3A', floor: '3', door: 'A',  type: 'VIVIENDA', ownerEmail: null },
    { label: '3B', floor: '3', door: 'B',  type: 'VIVIENDA', ownerEmail: null },
    { label: 'Garaje-1', floor: '0', door: 'G1', type: 'GARAJE', ownerEmail: 'ana.garcia@demo.com' },
    { label: 'Garaje-2', floor: '0', door: 'G2', type: 'GARAJE', ownerEmail: 'carlos.martin@demo.com' },
  ];

  const comm1Units = {};
  for (const def of comm1UnitDefs) {
    let unit = await prisma.unit.findUnique({
      where: { communityId_label: { communityId: comm1.id, label: def.label } },
    });
    if (!unit) {
      unit = await prisma.unit.create({
        data: {
          communityId: comm1.id,
          type: def.type,
          label: def.label,
          floor: def.floor,
          door: def.door,
        },
      });
      console.log(`✅ Unidad creada: ${comm1.name} / ${def.label}`);
    }
    comm1Units[def.label] = unit;

    // Create ownership if there's an owner
    if (def.ownerEmail) {
      const owner = residents[def.ownerEmail];
      const existingOwnership = await prisma.ownership.findFirst({
        where: { unitId: unit.id, ownerId: owner.id, endDate: null },
      });
      if (!existingOwnership) {
        await prisma.ownership.create({
          data: {
            unitId: unit.id,
            ownerId: owner.id,
            startDate: new Date('2024-01-01'),
            sharePct: 100,
          },
        });
        console.log(`✅ Titularidad: ${def.ownerEmail} → ${def.label}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. COMMUNITY 2 — Avenida Libertad 8
  // ─────────────────────────────────────────────────────────────
  let comm2 = await prisma.community.findFirst({ where: { cif: 'H08987654' } });
  if (!comm2) {
    comm2 = await prisma.community.create({
      data: {
        name: 'Edificio Avenida Libertad 8',
        address: 'Avenida de la Libertad, 8',
        city: 'Barcelona',
        postalCode: '08001',
        country: 'ES',
        cif: 'H08987654',
      },
    });
    console.log(`✅ Comunidad 2 creada: ${comm2.name}`);
  } else {
    console.log(`ℹ️  Comunidad 2 ya existe: ${comm2.name}`);
  }

  await prisma.communityAdmin.upsert({
    where: { communityId_userId: { communityId: comm2.id, userId: demoAdmin.id } },
    create: { communityId: comm2.id, userId: demoAdmin.id },
    update: {},
  });

  const comm2UnitDefs = [
    { label: 'P1', floor: '1', type: 'VIVIENDA', ownerEmail: 'lucia.rodriguez@demo.com' },
    { label: 'P2', floor: '2', type: 'VIVIENDA', ownerEmail: 'pedro.lopez@demo.com' },
    { label: 'P3', floor: '3', type: 'VIVIENDA', ownerEmail: null },
    { label: 'Local-1', floor: '0', type: 'LOCAL', ownerEmail: null },
    { label: 'Local-2', floor: '0', type: 'LOCAL', ownerEmail: null },
  ];

  const comm2Units = {};
  for (const def of comm2UnitDefs) {
    let unit = await prisma.unit.findUnique({
      where: { communityId_label: { communityId: comm2.id, label: def.label } },
    });
    if (!unit) {
      unit = await prisma.unit.create({
        data: {
          communityId: comm2.id,
          type: def.type,
          label: def.label,
          floor: def.floor,
        },
      });
      console.log(`✅ Unidad creada: ${comm2.name} / ${def.label}`);
    }
    comm2Units[def.label] = unit;

    if (def.ownerEmail) {
      const owner = residents[def.ownerEmail];
      const existingOwnership = await prisma.ownership.findFirst({
        where: { unitId: unit.id, ownerId: owner.id, endDate: null },
      });
      if (!existingOwnership) {
        await prisma.ownership.create({
          data: {
            unitId: unit.id,
            ownerId: owner.id,
            startDate: new Date('2024-01-01'),
            sharePct: 100,
          },
        });
        console.log(`✅ Titularidad: ${def.ownerEmail} → ${def.label}`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 6. COMMUNITY 3 — Plaza España 3
  // ─────────────────────────────────────────────────────────────
  let comm3 = await prisma.community.findFirst({ where: { cif: 'H46555777' } });
  if (!comm3) {
    comm3 = await prisma.community.create({
      data: {
        name: 'Residencial Plaza España 3',
        address: 'Plaza de España, 3',
        city: 'Valencia',
        postalCode: '46001',
        country: 'ES',
        cif: 'H46555777',
      },
    });
    console.log(`✅ Comunidad 3 creada: ${comm3.name}`);
  } else {
    console.log(`ℹ️  Comunidad 3 ya existe: ${comm3.name}`);
  }

  await prisma.communityAdmin.upsert({
    where: { communityId_userId: { communityId: comm3.id, userId: demoAdmin.id } },
    create: { communityId: comm3.id, userId: demoAdmin.id },
    update: {},
  });

  const comm3UnitDefs = [
    { label: 'A', floor: '1', type: 'VIVIENDA' },
    { label: 'B', floor: '1', type: 'VIVIENDA' },
    { label: 'C', floor: '2', type: 'VIVIENDA' },
    { label: 'D', floor: '2', type: 'VIVIENDA' },
  ];

  for (const def of comm3UnitDefs) {
    const exists = await prisma.unit.findUnique({
      where: { communityId_label: { communityId: comm3.id, label: def.label } },
    });
    if (!exists) {
      await prisma.unit.create({
        data: {
          communityId: comm3.id,
          type: def.type,
          label: def.label,
          floor: def.floor,
        },
      });
      console.log(`✅ Unidad creada: ${comm3.name} / ${def.label}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 7. BUDGET for Community 1 — year 2026
  // ─────────────────────────────────────────────────────────────
  let budget = await prisma.budget.findUnique({
    where: { communityId_year: { communityId: comm1.id, year: 2026 } },
  });
  if (!budget) {
    budget = await prisma.budget.create({
      data: {
        communityId: comm1.id,
        year: 2026,
        lines: {
          create: [
            { category: 'CLEANING',    amount: 3600 },
            { category: 'LIFT',        amount: 1200 },
            { category: 'INSURANCE',   amount: 800 },
            { category: 'ELECTRICITY', amount: 600 },
            { category: 'MAINTENANCE', amount: 1000 },
            { category: 'OTHER',       amount: 400 },
          ],
        },
      },
    });
    console.log(`✅ Presupuesto 2026 creado para ${comm1.name}`);
  } else {
    console.log(`ℹ️  Presupuesto 2026 ya existe para ${comm1.name}`);
  }

  // ─────────────────────────────────────────────────────────────
  // 8. EXPENSES for Community 1
  // ─────────────────────────────────────────────────────────────
  const expenseDefs = [
    {
      concept: 'Factura limpieza enero',
      category: 'CLEANING',
      amount: 300,
      expenseDate: new Date('2026-01-05'),
    },
    {
      concept: 'Revisión ascensor Q1',
      category: 'LIFT',
      amount: 400,
      expenseDate: new Date('2026-02-10'),
    },
    {
      concept: 'Seguro comunidad 2026',
      category: 'INSURANCE',
      amount: 800,
      expenseDate: new Date('2026-01-01'),
    },
    {
      concept: 'Reparación gotera terraza',
      category: 'MAINTENANCE',
      amount: 650,
      expenseDate: new Date('2026-04-15'),
    },
  ];

  for (const def of expenseDefs) {
    const existing = await prisma.expense.findFirst({
      where: { communityId: comm1.id, concept: def.concept },
    });
    if (!existing) {
      await prisma.expense.create({
        data: {
          communityId: comm1.id,
          concept: def.concept,
          category: def.category,
          amount: def.amount,
          expenseDate: def.expenseDate,
          recordedById: demoAdmin.id,
        },
      });
      console.log(`✅ Gasto creado: ${def.concept}`);
    } else {
      console.log(`ℹ️  Gasto ya existe: ${def.concept}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 9. INVOICES for Community 1
  // The owned units (with residents) are: 1A (Ana), 1B (Carlos), 2A (María), 2B (José)
  // ─────────────────────────────────────────────────────────────

  // Invoice 1 — Cuota ordinaria enero 2026
  let invoice1 = await prisma.invoice.findFirst({
    where: { communityId: comm1.id, concept: 'Cuota ordinaria enero 2026' },
  });
  if (!invoice1) {
    invoice1 = await prisma.invoice.create({
      data: {
        communityId: comm1.id,
        type: 'INDIVIDUAL',
        concept: 'Cuota ordinaria enero 2026',
        description: 'Cuota mensual ordinaria correspondiente a enero de 2026',
        totalAmount: 600,           // 4 units × 150€
        issueDate: new Date('2026-01-01'),
        dueDate: new Date('2026-01-31'),
        issuedById: demoAdmin.id,
      },
    });
    console.log(`✅ Factura creada: ${invoice1.concept}`);
  } else {
    console.log(`ℹ️  Factura ya existe: ${invoice1.concept}`);
  }

  // Invoice items for invoice 1
  const inv1ItemDefs = [
    { label: '1A', ownerId: anaUser.id },
    { label: '1B', ownerId: carlosUser.id },
    { label: '2A', ownerId: mariaUser.id },
    { label: '2B', ownerId: joseUser.id },
  ];

  for (const def of inv1ItemDefs) {
    const unit = comm1Units[def.label];
    const existingItem = await prisma.invoiceItem.findUnique({
      where: { invoiceId_unitId: { invoiceId: invoice1.id, unitId: unit.id } },
    });
    if (!existingItem) {
      await prisma.invoiceItem.create({
        data: {
          invoiceId: invoice1.id,
          unitId: unit.id,
          amount: 150,
        },
      });
      console.log(`✅ Item factura enero: unidad ${def.label}`);
    }
  }

  // Payments for invoice 1: Ana PAID, Carlos PAID, María UNPAID, José UNPAID
  const inv1PaidLabels = ['1A', '1B'];
  for (const label of inv1PaidLabels) {
    const unit = comm1Units[label];
    const item = await prisma.invoiceItem.findUnique({
      where: { invoiceId_unitId: { invoiceId: invoice1.id, unitId: unit.id } },
    });
    if (item) {
      const existingPayment = await prisma.payment.findFirst({
        where: { invoiceItemId: item.id },
      });
      if (!existingPayment) {
        await prisma.payment.create({
          data: {
            invoiceItemId: item.id,
            amount: 150,
            paidAt: new Date('2026-01-20'),
            method: 'BANK_TRANSFER',
            reference: `CUOTA-ENE26-${label}`,
            registeredById: demoAdmin.id,
          },
        });
        console.log(`✅ Pago enero registrado: unidad ${label}`);
      }
    }
  }

  // Invoice 2 — Cuota ordinaria febrero 2026
  let invoice2 = await prisma.invoice.findFirst({
    where: { communityId: comm1.id, concept: 'Cuota ordinaria febrero 2026' },
  });
  if (!invoice2) {
    invoice2 = await prisma.invoice.create({
      data: {
        communityId: comm1.id,
        type: 'INDIVIDUAL',
        concept: 'Cuota ordinaria febrero 2026',
        description: 'Cuota mensual ordinaria correspondiente a febrero de 2026',
        totalAmount: 600,
        issueDate: new Date('2026-02-01'),
        dueDate: new Date('2026-02-28'),
        issuedById: demoAdmin.id,
      },
    });
    console.log(`✅ Factura creada: ${invoice2.concept}`);
  } else {
    console.log(`ℹ️  Factura ya existe: ${invoice2.concept}`);
  }

  // Invoice items for invoice 2
  for (const def of inv1ItemDefs) {
    const unit = comm1Units[def.label];
    const existingItem = await prisma.invoiceItem.findUnique({
      where: { invoiceId_unitId: { invoiceId: invoice2.id, unitId: unit.id } },
    });
    if (!existingItem) {
      await prisma.invoiceItem.create({
        data: {
          invoiceId: invoice2.id,
          unitId: unit.id,
          amount: 150,
        },
      });
      console.log(`✅ Item factura febrero: unidad ${def.label}`);
    }
  }

  // Payment for invoice 2: only Ana PAID
  const unit1A = comm1Units['1A'];
  const inv2Item1A = await prisma.invoiceItem.findUnique({
    where: { invoiceId_unitId: { invoiceId: invoice2.id, unitId: unit1A.id } },
  });
  if (inv2Item1A) {
    const existingPayment = await prisma.payment.findFirst({
      where: { invoiceItemId: inv2Item1A.id },
    });
    if (!existingPayment) {
      await prisma.payment.create({
        data: {
          invoiceItemId: inv2Item1A.id,
          amount: 150,
          paidAt: new Date('2026-02-15'),
          method: 'BANK_TRANSFER',
          reference: 'CUOTA-FEB26-1A',
          registeredById: demoAdmin.id,
        },
      });
      console.log(`✅ Pago febrero registrado: unidad 1A`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 10. ANNOUNCEMENTS for Community 1
  // ─────────────────────────────────────────────────────────────
  const announcementDefs = [
    {
      title: 'Obras ascensor semana del 10 de febrero',
      body: `Estimados vecinos,\n\nLes comunicamos que durante la semana del 10 al 14 de febrero de 2026 se procederá a la revisión anual obligatoria y mantenimiento preventivo del ascensor del edificio.\n\nDurante ese período el ascensor podrá estar fuera de servicio durante algunas horas cada día. Les pedimos disculpas por las molestias ocasionadas.\n\nPara cualquier urgencia o necesidad especial, por favor contacten con la administración.\n\nUn saludo,\nAdministración Calle Mayor 15`,
      publishedAt: new Date('2026-02-01'),
      pinned: true,
    },
    {
      title: 'Junta general ordinaria convocada para el 15 de marzo',
      body: `Estimados propietarios,\n\nSe convoca a todos los propietarios de la Comunidad de Vecinos Calle Mayor 15 a la celebración de la JUNTA GENERAL ORDINARIA correspondiente al ejercicio 2025/2026.\n\nFecha: Sábado, 15 de marzo de 2026\nHora: 10:00 (primera convocatoria) / 10:30 (segunda convocatoria)\nLugar: Sala de reuniones — Calle Mayor 15, portal 1\n\nORDEN DEL DÍA:\n1. Aprobación de las actas de la junta anterior\n2. Estado de cuentas 2025 y balance\n3. Aprobación del presupuesto 2026\n4. Obras pendientes: accesibilidad portal\n5. Ruegos y preguntas\n\nSe ruega puntualidad y confirmación de asistencia a través del portal o por email a la administración.\n\nUn cordial saludo,\nMaría González — Administradora de Fincas`,
      publishedAt: new Date('2026-02-20'),
      pinned: false,
    },
  ];

  for (const def of announcementDefs) {
    const existing = await prisma.announcement.findFirst({
      where: { communityId: comm1.id, title: def.title },
    });
    if (!existing) {
      await prisma.announcement.create({
        data: {
          communityId: comm1.id,
          authorId: demoAdmin.id,
          title: def.title,
          body: def.body,
          pinned: def.pinned,
          publishedAt: def.publishedAt,
        },
      });
      console.log(`✅ Anuncio creado: ${def.title}`);
    } else {
      console.log(`ℹ️  Anuncio ya existe: ${def.title}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 11. MEETING for Community 1
  // ─────────────────────────────────────────────────────────────
  let meeting1 = await prisma.meeting.findFirst({
    where: { communityId: comm1.id, title: 'Junta General Ordinaria 2026' },
  });
  if (!meeting1) {
    meeting1 = await prisma.meeting.create({
      data: {
        communityId: comm1.id,
        title: 'Junta General Ordinaria 2026',
        type: 'ORDINARY',
        status: 'SCHEDULED',
        scheduledAt: new Date('2026-03-15T10:00:00.000Z'),
        location: 'Sala de reuniones — Calle Mayor 15, portal 1',
        agenda: '1. Aprobación actas anteriores\n2. Estado de cuentas 2025\n3. Presupuesto 2026\n4. Obras pendientes\n5. Ruegos y preguntas',
        organizedById: demoAdmin.id,
      },
    });
    console.log(`✅ Junta creada: ${meeting1.title}`);
  } else {
    console.log(`ℹ️  Junta ya existe: ${meeting1.title}`);
  }

  // ─────────────────────────────────────────────────────────────
  // 12. INCIDENTS for Community 1
  // ─────────────────────────────────────────────────────────────
  const incidentDefs = [
    {
      number: 1,
      title: 'Avería ascensor — parada entre plantas',
      description: 'El ascensor quedó detenido entre la planta 2 y la planta 3. Los técnicos fueron avisados de inmediato.',
      category: 'LIFT',
      status: 'RESOLVED',
      resolvedAt: new Date('2026-02-12'),
      resolution: 'Revisado y reparado por técnico el 12/02/2026. Se sustituyó el contactor principal del sistema eléctrico.',
    },
    {
      number: 2,
      title: 'Humedad en garaje planta -1',
      description: 'Se detecta filtración de agua en la esquina noroeste del garaje. La mancha de humedad mide aproximadamente 2 metros cuadrados y está creciendo.',
      category: 'STRUCTURAL',
      status: 'IN_PROGRESS',
      resolvedAt: null,
      resolution: null,
    },
  ];

  for (const def of incidentDefs) {
    const existing = await prisma.incidentLog.findUnique({
      where: { communityId_number: { communityId: comm1.id, number: def.number } },
    });
    if (!existing) {
      await prisma.incidentLog.create({
        data: {
          communityId: comm1.id,
          number: def.number,
          title: def.title,
          description: def.description,
          category: def.category,
          status: def.status,
          reportedById: demoAdmin.id,
          resolvedAt: def.resolvedAt,
          resolution: def.resolution,
          photos: [],
        },
      });
      console.log(`✅ Incidencia creada: #${def.number} ${def.title}`);
    } else {
      console.log(`ℹ️  Incidencia ya existe: #${def.number} ${def.title}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 13. UNIT NOTES (private admin notes)
  // ─────────────────────────────────────────────────────────────
  const unitNoteDefs = [
    {
      unitLabel: '1A',
      content: 'Propietaria muy colaboradora. Paga siempre puntual. Solicita recibos por email.',
    },
    {
      unitLabel: '2A',
      content: 'MOROSA. 2 cuotas pendientes desde enero. Contactada en marzo sin respuesta. Pendiente de gestión.',
    },
  ];

  for (const def of unitNoteDefs) {
    const unit = comm1Units[def.unitLabel];
    const existing = await prisma.unitNote.findFirst({
      where: { unitId: unit.id, authorId: demoAdmin.id },
    });
    if (!existing) {
      await prisma.unitNote.create({
        data: {
          unitId: unit.id,
          authorId: demoAdmin.id,
          content: def.content,
        },
      });
      console.log(`✅ Nota creada para unidad ${def.unitLabel}`);
    } else {
      console.log(`ℹ️  Nota ya existe para unidad ${def.unitLabel}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  console.log('\n🎉 Seed completado con éxito.');
  console.log('\n📋 Credenciales de acceso:');
  console.log('   SUPPORT:    support@comugest.app     / Support1234');
  console.log('   ADMIN DEMO: admin@demo.comugest.app  / Demo1234!');
  console.log('   Vecino 1:   ana.garcia@demo.com      / Demo1234!');
  console.log('   Vecino 2:   carlos.martin@demo.com   / Demo1234!');
  console.log('   Vecino 3:   maria.sanchez@demo.com   / Demo1234!');
  console.log('   Vecino 4:   jose.fernandez@demo.com  / Demo1234!');
  console.log('   Vecino 5:   lucia.rodriguez@demo.com / Demo1234!');
  console.log('   Vecino 6:   pedro.lopez@demo.com     / Demo1234!');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
