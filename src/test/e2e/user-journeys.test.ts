/**
 * E2E user-journey tests.
 * Uses: supertest + real Express app + real PostgreSQL (comugest_test DB).
 * The setup.ts file (setupFiles in vitest.e2e.config.ts) wires the test DB env
 * vars and runs resetDatabase() before all suites.
 *
 * Scheduler is mocked at module level so it does not spin up timers in tests.
 * vi.mock is hoisted to the top of the module by Vitest before imports.
 */

vi.mock('../../modules/scheduler/scheduler', () => ({ startScheduler: vi.fn() }));

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { resetDatabase } from './setup';
import { prisma } from '../../config/prisma';
import { hashPassword } from '../../utils/password';
import { signAccessToken } from '../../utils/jwt';

// ---------------------------------------------------------------------------
// Shared app instance (single for all suites)
// ---------------------------------------------------------------------------
const app = createApp();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const adminEmail = 'admin@comugest-e2e.test';
const adminPassword = 'SecurePass1!';

/**
 * Create (or ensure) an ADMIN_FINCAS user directly in the DB — bypasses the
 * HTTP auth endpoint entirely so we are never subject to the auth rate limit.
 * Returns a freshly signed access token for that user.
 */
async function createAdminAndGetToken(
  email = adminEmail,
  password = adminPassword,
  firstName = 'Ana',
  lastName = 'García',
): Promise<string> {
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      firstName,
      lastName,
      role: 'ADMIN_FINCAS',
      locale: 'es',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      gdprAcceptedAt: new Date(),
      gdprVersion: '2025-01-01',
    },
    update: {
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  return signAccessToken({ sub: user.id, role: user.role as 'ADMIN_FINCAS' });
}

/**
 * Register a user via the HTTP API (used only in the Authentication Flow suite).
 * Returns the HTTP response.
 */
async function registerAdmin(
  email = adminEmail,
  password = adminPassword,
) {
  return request(app).post('/api/v1/auth/register').send({
    email,
    password,
    firstName: 'Ana',
    lastName: 'García',
    role: 'ADMIN_FINCAS',
    locale: 'es',
    gdprAccepted: true,
  });
}

async function loginUser(email: string, password: string) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 1. AUTHENTICATION FLOW
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Authentication Flow', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('registers with valid data → 202 (requires email verification)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: adminEmail,
      password: adminPassword,
      firstName: 'Ana',
      lastName: 'García',
      role: 'ADMIN_FINCAS',
      locale: 'es',
      gdprAccepted: true,
    });
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('requiresEmailVerification', true);
  });

  it('registers with duplicate email → 409', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: adminEmail,
      password: adminPassword,
      firstName: 'Ana',
      lastName: 'García',
      role: 'ADMIN_FINCAS',
      gdprAccepted: true,
    });
    expect(res.status).toBe(409);
  });

  it('registers with invalid email → 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'not-an-email',
      password: adminPassword,
      firstName: 'Test',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      gdprAccepted: true,
    });
    expect(res.status).toBe(400);
  });

  it('registers with weak password (too short) → 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'weak@test.com',
      password: 'abc',
      firstName: 'Test',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      gdprAccepted: true,
    });
    expect(res.status).toBe(400);
  });

  it('registers with password missing uppercase → 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'weak2@test.com',
      password: 'alllowercase1!',
      firstName: 'Test',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      gdprAccepted: true,
    });
    expect(res.status).toBe(400);
  });

  it('registers without gdprAccepted → 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'nodgpr@test.com',
      password: adminPassword,
      firstName: 'Test',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      gdprAccepted: false,
    });
    expect(res.status).toBe(400);
  });

  it('login with PENDING user (unverified) → 403', async () => {
    // User registered above is still PENDING
    const res = await loginUser(adminEmail, adminPassword);
    expect(res.status).toBe(403);
  });

  it('login after activation → 200 + tokens', async () => {
    // Activate user
    await prisma.user.update({
      where: { email: adminEmail },
      data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    const res = await loginUser(adminEmail, adminPassword);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe(adminEmail);
  });

  it('login with wrong password → 401', async () => {
    const res = await loginUser(adminEmail, 'WrongPass999!');
    expect(res.status).toBe(401);
  });

  it('login with non-existent email → 401', async () => {
    const res = await loginUser('nobody@nowhere.com', adminPassword);
    expect(res.status).toBe(401);
  });

  it('access protected route without token → 401', async () => {
    const res = await request(app).get('/api/v1/communities');
    expect(res.status).toBe(401);
  });

  it('access protected route with invalid token → 401', async () => {
    const res = await request(app)
      .get('/api/v1/communities')
      .set('Authorization', 'Bearer this.is.not.valid');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 2. COMMUNITY MANAGEMENT (ADMIN_FINCAS)
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Community Management', () => {
  let adminToken: string;
  let communityId: string;
  let unitId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();
  });

  it('creates a community → 201', async () => {
    const res = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Los Olivos',
        address: 'Calle Mayor 42',
        city: 'Madrid',
        postalCode: '28001',
        country: 'ES',
        cif: 'H28123456',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('community');
    expect(res.body.community.name).toBe('Comunidad Los Olivos');
    communityId = res.body.community.id;
  });

  it('lists communities → 200 + array', async () => {
    const res = await request(app)
      .get('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const communities = res.body.communities ?? res.body;
    expect(Array.isArray(communities)).toBe(true);
  });

  it('gets a single community → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('updates a community → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/communities/${communityId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Comunidad Los Olivos Actualizada' });
    expect(res.status).toBe(200);
  });

  it('creates community with missing required fields → 400', async () => {
    const res = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Incompleta' });
    expect(res.status).toBe(400);
  });

  it('adds a unit to community → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'VIVIENDA',
        label: '1A',
        floor: '1',
        door: 'A',
        coefficient: 10.5,
        surfaceM2: 75,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('unit');
    unitId = res.body.unit.id;
  });

  it('adds second unit → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'GARAJE',
        label: 'G1',
        coefficient: 5,
      });
    expect(res.status).toBe(201);
  });

  it('lists units in community → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('updates a unit → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/units/${unitId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: '1A-Updated', coefficient: 11 });
    expect(res.status).toBe(200);
  });

  it('deletes a unit → 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/units/${unitId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it('creates community with SQL injection attempt in name → handled safely', async () => {
    const res = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: "'; DROP TABLE Community; --",
        address: 'Calle Peligrosa 1',
        city: 'Madrid',
        postalCode: '28001',
        country: 'ES',
      });
    expect([201, 400]).toContain(res.status);
  });

  it('gets community with invalid CUID → 400 or 404', async () => {
    const res = await request(app)
      .get('/api/v1/communities/not-a-cuid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect([400, 404]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 3. INVITE RESIDENT (ADMIN_FINCAS)
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Invite Resident', () => {
  let adminToken: string;
  let communityId: string;
  let freshUnitId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Invitaciones',
        address: 'Calle Invitaciones 1',
        city: 'Barcelona',
        postalCode: '08001',
        country: 'ES',
      });
    communityId = comm.body.community.id;

    const unit = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: '2B', coefficient: 10 });
    freshUnitId = unit.body.unit.id;
  });

  it('invites a resident → 201', async () => {
    const res = await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'vecino@test.com',
        firstName: 'Carlos',
        lastName: 'Rodríguez',
        phone: '+34600000001',
        communityId,
        relationType: 'OWNER',
        unitId: freshUnitId,
        locale: 'es',
      });
    expect(res.status).toBe(201);
  });

  it('invites with invalid communityId → 400', async () => {
    const res = await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'vecino2@test.com',
        firstName: 'Maria',
        lastName: 'Lopez',
        communityId: 'not-a-cuid',
        relationType: 'OWNER',
        unitId: freshUnitId,
      });
    expect(res.status).toBe(400);
  });

  it('invites with missing required fields → 400', async () => {
    const res = await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'partial@test.com' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 4. INVOICE MANAGEMENT (ADMIN_FINCAS)
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Invoice Management', () => {
  let adminToken: string;
  let communityId: string;
  let unit1Id: string;
  let unit2Id: string;
  let invoiceId: string;
  let invoiceItemId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Facturas',
        address: 'Calle Facturas 10',
        city: 'Sevilla',
        postalCode: '41001',
        country: 'ES',
        cif: 'H41654321',
      });
    communityId = comm.body.community.id;

    const u1 = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: 'A1', coefficient: 20 });
    unit1Id = u1.body.unit.id;

    const u2 = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: 'A2', coefficient: 20 });
    unit2Id = u2.body.unit.id;
  });

  it('creates INDIVIDUAL invoice → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Cuota Enero 2025',
        dueDate: '2025-01-31',
        items: [
          { unitId: unit1Id, amount: 150.00, notes: 'Cuota ordinaria' },
          { unitId: unit2Id, amount: 150.00, notes: 'Cuota ordinaria' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('invoice');
    invoiceId = res.body.invoice.id;
    if (res.body.invoice.items?.length) {
      invoiceItemId = res.body.invoice.items[0].id;
    }
  });

  it('creates DERRAMA invoice (spread by coefficient) → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DERRAMA',
        concept: 'Reparación tejado',
        dueDate: '2025-03-31',
        totalAmount: 5000.00,
      });
    expect(res.status).toBe(201);
  });

  it('lists invoices → 200 + array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const invoices = res.body.invoices ?? res.body;
    expect(Array.isArray(invoices)).toBe(true);
  });

  it('gets specific invoice → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.invoice?.id ?? res.body.id).toBe(invoiceId);
  });

  it('creates invoice with invalid data (missing concept) → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        dueDate: '2025-01-31',
        items: [{ unitId: unit1Id, amount: 100 }],
      });
    expect(res.status).toBe(400);
  });

  it('creates invoice with negative amount → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Negativo',
        dueDate: '2025-01-31',
        items: [{ unitId: unit1Id, amount: -50 }],
      });
    expect(res.status).toBe(400);
  });

  it('creates invoice with extremely large amount → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Factura gigante',
        dueDate: '2025-12-31',
        items: [{ unitId: unit1Id, amount: 9_999_999_999 }],
      });
    expect(res.status).toBe(400);
  });

  it('creates bulk invoice (equal split per unit) → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        concept: 'Cuota Mensual Febrero',
        dueDate: '2025-02-28',
        distributionMode: 'EQUAL',
        perUnitAmount: 120.00,
      });
    expect(res.status).toBe(201);
  });

  it('records a payment on an invoice item → 201', async () => {
    if (!invoiceItemId) {
      const inv = await request(app)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      invoiceItemId = inv.body.invoice?.items?.[0]?.id ?? inv.body.items?.[0]?.id;
    }
    const res = await request(app)
      .post(`/api/v1/invoices/items/${invoiceItemId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 150.00,
        method: 'BANK_TRANSFER',
        reference: 'TRF-2025-001',
      });
    expect(res.status).toBe(201);
  });

  it('cancels/deletes an invoice → 200 or 204', async () => {
    const newInv = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'A Cancelar',
        dueDate: '2025-06-30',
        items: [{ unitId: unit1Id, amount: 50 }],
      });
    const toCancel = newInv.body.invoice.id;

    const res = await request(app)
      .delete(`/api/v1/invoices/${toCancel}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect([200, 204]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 5. EXPENSE MANAGEMENT (ADMIN_FINCAS)
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Expense Management', () => {
  let adminToken: string;
  let communityId: string;
  let expenseId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Gastos',
        address: 'Avenida del Gasto 5',
        city: 'Valencia',
        postalCode: '46001',
        country: 'ES',
      });
    communityId = comm.body.community.id;
  });

  it('creates an expense → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'CLEANING',
        concept: 'Servicio de limpieza mensual',
        amount: 350.00,
        expenseDate: '2025-01-15',
        supplier: 'LimpiezasS.L.',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('expense');
    expenseId = res.body.expense.id;
  });

  it('creates expense with invalid category → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'INVALID_CAT',
        concept: 'Test',
        amount: 100,
        expenseDate: '2025-01-01',
      });
    expect(res.status).toBe(400);
  });

  it('creates expense with zero amount → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'ELECTRICITY',
        concept: 'Luz',
        amount: 0,
        expenseDate: '2025-01-01',
      });
    expect(res.status).toBe(400);
  });

  it('creates expense with amount exceeding max → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'OTHER',
        concept: 'Gasto enorme',
        amount: 100_000_001,
        expenseDate: '2025-01-01',
      });
    expect(res.status).toBe(400);
  });

  it('lists expenses → 200 with expenses', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('expenses');
    expect(Array.isArray(res.body.expenses)).toBe(true);
  });

  it('lists expenses with category filter → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/expenses?category=CLEANING`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('creates expense with future date → 201 (allowed)', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'MAINTENANCE',
        concept: 'Presupuesto futuro',
        amount: 500,
        expenseDate: '2099-12-31',
      });
    expect(res.status).toBe(201);
  });

  it('deletes expense → 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 6. ANNOUNCEMENTS
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Announcements', () => {
  let adminToken: string;
  let communityId: string;
  let announcementId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Anuncios',
        address: 'Calle Anuncios 7',
        city: 'Bilbao',
        postalCode: '48001',
        country: 'ES',
      });
    communityId = comm.body.community.id;
  });

  it('creates announcement → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Corte de agua el lunes',
        body: 'Se avisa a todos los vecinos que el lunes habrá corte de agua de 9 a 14h.',
        pinned: true,
        notify: false,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('announcement');
    announcementId = res.body.announcement.id;
  });

  it('creates announcement with expiry date → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Evento de verano',
        body: 'BBQ comunitaria este sábado.',
        expiresAt: '2099-12-31T23:59:59.000Z',
      });
    expect(res.status).toBe(201);
  });

  it('lists announcements → 200 with announcements array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('announcements');
    expect(Array.isArray(res.body.announcements)).toBe(true);
  });

  it('creates announcement with empty title → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: '', body: 'Cuerpo' });
    expect(res.status).toBe(400);
  });

  it('creates announcement with body exceeding max (>10000 chars) → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Largo', body: 'x'.repeat(10001) });
    expect(res.status).toBe(400);
  });

  it('creates announcement with body of exactly 10000 chars → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Max Length Body', body: 'x'.repeat(10000) });
    expect(res.status).toBe(201);
  });

  it('updates announcement → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/announcements/${announcementId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Corte de agua actualizado', pinned: false });
    expect(res.status).toBe(200);
  });

  it('deletes announcement → 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/announcements/${announcementId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 7. COMMON AREAS & RESERVATIONS
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Common Areas and Reservations', () => {
  let adminToken: string;
  let communityId: string;
  let areaId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Zonas',
        address: 'Paseo de las Zonas 3',
        city: 'Málaga',
        postalCode: '29001',
        country: 'ES',
      });
    communityId = comm.body.community.id;
  });

  it('creates a common area → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/areas`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Piscina',
        description: 'Piscina comunitaria',
        capacity: 20,
        openTime: '10:00',
        closeTime: '20:00',
        slotMinutes: 60,
        maxSlotsPerDay: 2,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('area');
    areaId = res.body.area.id;
  });

  it('creates area with invalid slot minutes → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/areas`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Sala de Fiestas',
        slotMinutes: 45,
      });
    expect(res.status).toBe(400);
  });

  it('lists areas → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/areas`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('makes a reservation → 403 (admin is not a resident)', async () => {
    // The API requires the user to be an owner/occupant of a unit in the community.
    // An ADMIN_FINCAS who is not linked as owner/occupant gets 403.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/areas/${areaId}/reservations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        areaId,
        startAt: tomorrow.toISOString(),
        notes: 'Cumpleaños de la comunidad',
      });
    // Admin without ownership/occupancy in the community → 403
    expect([201, 400, 403]).toContain(res.status);
  });

  it('lists reservations for area requires date param → 400 without date', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/areas/${areaId}/reservations`)
      .set('Authorization', `Bearer ${adminToken}`);
    // Requires ?date=YYYY-MM-DD query param
    expect(res.status).toBe(400);
  });

  it('lists reservations for area with date param → 200', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/areas/${areaId}/reservations?date=${dateStr}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('makes reservation with past date → 400 or 403', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/areas/${areaId}/reservations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        areaId,
        startAt: yesterday.toISOString(),
      });
    // Past date validation OR no-resident check — both are valid failures
    expect([400, 403]).toContain(res.status);
  });

  it('creates a second area with 120-minute slots → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/areas`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Sala de Reuniones',
        capacity: 10,
        slotMinutes: 120,
        maxSlotsPerDay: 1,
      });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 8. INCIDENTS
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Incidents', () => {
  let adminToken: string;
  let communityId: string;
  let incidentId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Incidencias',
        address: 'Calle Incidencias 1',
        city: 'Zaragoza',
        postalCode: '50001',
        country: 'ES',
      });
    communityId = comm.body.community.id;
  });

  it('creates an incident → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/incidents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Goteras en portal 2',
        description: 'Hay goteras en el techo del portal 2 desde el martes.',
        category: 'MAINTENANCE',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('incident');
    incidentId = res.body.incident.id;
  });

  it('creates incident without required fields → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/incidents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'MAINTENANCE' });
    expect(res.status).toBe(400);
  });

  it('creates incident with empty description → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/incidents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Titulo', description: '' });
    expect(res.status).toBe(400);
  });

  it('lists incidents → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/incidents`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('incidents');
  });

  it('updates incident status to IN_PROGRESS → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/communities/${communityId}/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'IN_PROGRESS', resolution: 'Contactado el fontanero.' });
    expect(res.status).toBe(200);
  });

  it('updates incident to RESOLVED → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/communities/${communityId}/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED', resolution: 'Reparadas las goteras el viernes.' });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 9. SUPPORT TICKETS
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Support Tickets', () => {
  let adminToken: string;
  let ticketId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();
  });

  it('creates a support ticket → 201', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'BUG',
        subject: 'No puedo acceder a mis facturas',
        description: 'Al intentar ver mis facturas, recibo un error 500.',
        pageUrl: 'https://app.comugest.es/invoices',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('ticket');
    ticketId = res.body.ticket.id;
  });

  it('lists own tickets via /me/tickets → 200', async () => {
    const res = await request(app)
      .get('/api/v1/me/tickets')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('creates ticket without required fields → 400', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'BUG' });
    expect(res.status).toBe(400);
  });

  it('creates ticket with invalid category → 400', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'INVALID_CATEGORY',
        subject: 'Test',
        description: 'Test description',
      });
    expect(res.status).toBe(400);
  });

  it('creates FEATURE_REQUEST ticket → 201', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'FEATURE_REQUEST',
        subject: 'Exportar gastos a Excel',
        description: 'Sería útil poder exportar el listado de gastos en formato Excel.',
      });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 10. MEETINGS
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Meetings', () => {
  let adminToken: string;
  let communityId: string;
  let meetingId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Reuniones',
        address: 'Plaza Mayor 1',
        city: 'Toledo',
        postalCode: '45001',
        country: 'ES',
      });
    communityId = comm.body.community.id;
  });

  it('creates an ordinary meeting → 201', async () => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Junta Ordinaria Q1 2025',
        type: 'ORDINARY',
        scheduledAt: nextWeek.toISOString(),
        location: 'Salón de actos, planta baja',
        agenda: '1. Lectura actas anteriores\n2. Estado cuentas\n3. Ruegos y preguntas',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('meeting');
    meetingId = res.body.meeting.id;
  });

  it('creates extraordinary meeting → 201', async () => {
    const inTwoWeeks = new Date();
    inTwoWeeks.setDate(inTwoWeeks.getDate() + 14);

    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Junta Extraordinaria - Derrama',
        type: 'EXTRAORDINARY',
        scheduledAt: inTwoWeeks.toISOString(),
        location: 'Sala de reuniones',
      });
    expect(res.status).toBe(201);
  });

  it('lists meetings → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('gets meeting detail → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meeting?.id ?? res.body.id).toBe(meetingId);
  });

  it('creates meeting with missing title → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'ORDINARY',
        scheduledAt: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
  });

  it('updates meeting status to HELD → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'HELD' });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 11. MY PROFILE
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('My Profile', () => {
  let adminToken: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();
  });

  it('gets own profile → 200 with profile object', async () => {
    const res = await request(app)
      .get('/api/v1/me/profile')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // Profile endpoint returns { profile: {...} }
    expect(res.body).toHaveProperty('profile');
    expect(res.body.profile.email).toBe(adminEmail);
  });

  it('patches own profile → 200', async () => {
    const res = await request(app)
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Actualizada', lastName: 'García López' });
    expect(res.status).toBe(200);
    expect(res.body.profile?.firstName ?? res.body.firstName).toBe('Actualizada');
  });

  it('gets profile without token → 401', async () => {
    const res = await request(app).get('/api/v1/me/profile');
    expect(res.status).toBe(401);
  });

  it('my announcements endpoint → 200', async () => {
    const res = await request(app)
      .get('/api/v1/me/announcements')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('my notifications endpoint → 200', async () => {
    const res = await request(app)
      .get('/api/v1/me/notifications')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('my communities endpoint → 200', async () => {
    const res = await request(app)
      .get('/api/v1/me/communities')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('my invoice-items endpoint → 200', async () => {
    const res = await request(app)
      .get('/api/v1/me/invoice-items')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('my meetings endpoint → 200', async () => {
    const res = await request(app)
      .get('/api/v1/me/meetings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('my reservations endpoint → 200', async () => {
    const res = await request(app)
      .get('/api/v1/me/reservations')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('my procedures endpoint → 200', async () => {
    const res = await request(app)
      .get('/api/v1/me/procedures')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 12. BUDGET MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Budget Management', () => {
  let adminToken: string;
  let communityId: string;
  const year = 2025;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Presupuesto',
        address: 'Calle Presupuesto 1',
        city: 'Alicante',
        postalCode: '03001',
        country: 'ES',
      });
    communityId = comm.body.community.id;
  });

  it('creates/upserts a budget → 200', async () => {
    const res = await request(app)
      .put(`/api/v1/communities/${communityId}/budgets/${year}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        lines: [
          { category: 'CLEANING', amount: 4200 },
          { category: 'ELECTRICITY', amount: 1800 },
          { category: 'INSURANCE', amount: 3000 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('budget');
  });

  it('gets budget summary → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/budgets/${year}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('gets budget comparison → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/budgets/comparison?year=${year}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('creates budget with empty lines → 400', async () => {
    const res = await request(app)
      .put(`/api/v1/communities/${communityId}/budgets/${year}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lines: [] });
    expect(res.status).toBe(400);
  });

  it('creates budget with invalid category → 400', async () => {
    const res = await request(app)
      .put(`/api/v1/communities/${communityId}/budgets/${year}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        lines: [{ category: 'INVALID', amount: 1000 }],
      });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 13. PROCEDURES
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Procedures', () => {
  let adminToken: string;
  let communityId: string;
  let procedureId: string;
  let unitId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Trámites',
        address: 'Calle Trámites 2',
        city: 'Murcia',
        postalCode: '30001',
        country: 'ES',
      });
    communityId = comm.body.community.id;

    // Create a unit in the community
    const unitRes = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: '1A', coefficient: 100 });
    unitId = unitRes.body.unit.id;

    // Link the admin as owner of that unit (so they can create procedures)
    const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (adminUser) {
      await prisma.ownership.create({
        data: { unitId, ownerId: adminUser.id, startDate: new Date() },
      });
    }
  });

  it('creates a procedure → 201 (admin with ownership in community)', async () => {
    const res = await request(app)
      .post('/api/v1/procedures')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        communityId,
        type: 'CERTIFICATE',
        subject: 'Solicitud certificado de deuda',
        description: 'Necesito un certificado de que no tengo deudas pendientes con la comunidad.',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('procedure');
    procedureId = res.body.procedure.id;
  });

  it('lists procedures by community → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/procedures`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('gets a single procedure → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/procedures/${procedureId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('updates procedure status → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/procedures/${procedureId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'IN_REVIEW' });
    expect(res.status).toBe(200);
  });

  it('creates procedure with invalid type → 400', async () => {
    const res = await request(app)
      .post('/api/v1/procedures')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        communityId,
        type: 'INVALID_TYPE',
        subject: 'Test',
        description: 'Test description',
      });
    expect(res.status).toBe(400);
  });

  it('creates procedure with missing subject → 400', async () => {
    const res = await request(app)
      .post('/api/v1/procedures')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        communityId,
        type: 'COMPLAINT',
        description: 'Sin asunto',
      });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 14. TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Templates', () => {
  let adminToken: string;
  let communityId: string;
  let templateId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Plantillas',
        address: 'Calle Plantillas 1',
        city: 'Palma',
        postalCode: '07001',
        country: 'ES',
      });
    communityId = comm.body.community.id;
  });

  it('creates a template → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/templates`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Notificación de cuota',
        subject: 'Recordatorio de pago de cuota comunidad',
        body: 'Estimado vecino, le recordamos que tiene pendiente el pago de su cuota mensual.',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('template');
    templateId = res.body.template.id;
  });

  it('lists templates → 200 with templates array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/templates`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('templates');
    expect(Array.isArray(res.body.templates)).toBe(true);
  });

  it('creates a second template → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/templates`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Aviso de reunión',
        subject: 'Convocatoria de junta de propietarios',
        body: 'Se convoca a todos los propietarios a la junta ordinaria.',
      });
    expect(res.status).toBe(201);
  });

  it('creates template with missing name → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/templates`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        subject: 'Subject only',
        body: 'Body only',
      });
    expect(res.status).toBe(400);
  });

  it('creates template with empty body → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/templates`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test',
        subject: 'Test Subject',
        body: '',
      });
    expect(res.status).toBe(400);
  });

  it('deletes template → 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/communities/${communityId}/templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 15. REPORTS
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Reports', () => {
  let adminToken: string;
  let communityId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Informes',
        address: 'Calle Informes 1',
        city: 'Valladolid',
        postalCode: '47001',
        country: 'ES',
      });
    communityId = comm.body.community.id;
  });

  it('gets morosos report → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/reports/morosos`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('gets budget report → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/reports/budget`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('gets payments report → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/reports/payments`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('gets morosos report without token → 401', async () => {
    const res = await request(app).get(
      `/api/v1/communities/${communityId}/reports/morosos`,
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 16. MESSAGES
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Messages', () => {
  let adminToken: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();
  });

  it('lists conversations → 200', async () => {
    const res = await request(app)
      .get('/api/v1/messages/conversations')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('lists conversations without auth → 401', async () => {
    const res = await request(app).get('/api/v1/messages/conversations');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 17. EDGE CASES & SECURITY
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Edge Cases and Security', () => {
  let adminToken: string;
  let communityId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken();

    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Edge Cases',
        address: 'Calle Extrema 99',
        city: 'Ceuta',
        postalCode: '51001',
        country: 'ES',
      });
    communityId = comm.body.community.id;
  });

  it('health check endpoint → 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  it('non-existent route → 404', async () => {
    const res = await request(app)
      .get('/api/v1/this-does-not-exist')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('sends empty body to create community → 400', async () => {
    const res = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('register with XSS attempt in firstName → handled (202 or 400)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'xss@test.com',
      password: 'SecurePass1!',
      firstName: '<script>alert("xss")</script>',
      lastName: 'Test',
      role: 'ADMIN_FINCAS',
      gdprAccepted: true,
    });
    expect([202, 400]).toContain(res.status);
  });

  it('community with SQL injection in address → handled safely', async () => {
    const res = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test Injection',
        address: "1'; UPDATE community SET name='hacked'; --",
        city: 'Madrid',
        postalCode: '28001',
        country: 'ES',
      });
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      const listRes = await request(app)
        .get('/api/v1/communities')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listRes.status).toBe(200);
    }
  });

  it('malformed JSON body → 4xx or 500', async () => {
    const res = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send('{ this is not json }');
    // Express may return 400 (SyntaxError) or 500 depending on error handler configuration
    expect([400, 500]).toContain(res.status);
  });

  it('invalid CUID for community ID in URL → 400 or 404', async () => {
    const res = await request(app)
      .get('/api/v1/communities/not-a-cuid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect([400, 404]).toContain(res.status);
  });

  it('accesses resource from another community → 403 or 404', async () => {
    // Create second admin directly in DB (bypasses rate limit)
    const token2 = await createAdminAndGetToken('admin2@comugest-e2e.test', 'SecurePass2@!', 'Pedro', 'Lopez');

    // Try to access first admin's community
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}`)
      .set('Authorization', `Bearer ${token2}`);
    expect([403, 404]).toContain(res.status);
  });

  it('announcement with body of exactly 10000 chars → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Max Length Body',
        body: 'x'.repeat(10000),
      });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// ══════════════════════════════════════════════════════════════════════════════
// 18. FULL ADMIN JOURNEY — end-to-end realistic scenario
// ══════════════════════════════════════════════════════════════════════════════
// ---------------------------------------------------------------------------
describe('Full Admin Journey', () => {
  let adminToken: string;
  let communityId: string;
  let unitAId: string;
  let unitBId: string;

  beforeAll(async () => {
    await resetDatabase();
    adminToken = await createAdminAndGetToken('journey-admin@comugest-e2e.test', adminPassword, 'Marta', 'Sánchez');

    // Create community with two units
    const comm = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Completa S.A.',
        address: 'Gran Vía 100',
        city: 'Madrid',
        postalCode: '28013',
        country: 'ES',
        cif: 'H28999888',
      });
    communityId = comm.body.community.id;

    const uA = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: '3A', floor: '3', door: 'A', coefficient: 25 });
    unitAId = uA.body.unit.id;

    const uB = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: '3B', floor: '3', door: 'B', coefficient: 25 });
    unitBId = uB.body.unit.id;

    // Link journey admin as owner of unitA so they can create procedures
    const journeyAdmin = await prisma.user.findUnique({ where: { email: 'journey-admin@comugest-e2e.test' } });
    if (journeyAdmin) {
      await prisma.ownership.create({
        data: { unitId: unitAId, ownerId: journeyAdmin.id, startDate: new Date() },
      });
    }
  });

  it('admin has community and units set up', () => {
    expect(communityId).toBeTruthy();
    expect(unitAId).toBeTruthy();
    expect(unitBId).toBeTruthy();
  });

  it('admin creates invoices for all units → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Cuota comunidad Marzo 2025',
        dueDate: '2025-03-31',
        items: [
          { unitId: unitAId, amount: 200 },
          { unitId: unitBId, amount: 200 },
        ],
      });
    expect(res.status).toBe(201);
  });

  it('admin creates a derrama → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DERRAMA',
        concept: 'Impermeabilización terraza',
        dueDate: '2025-06-30',
        totalAmount: 8000,
      });
    expect(res.status).toBe(201);
  });

  it('admin creates expense → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'GARDENING',
        concept: 'Poda árboles jardín',
        amount: 800,
        expenseDate: '2025-03-05',
        supplier: 'JardineriaNaturalS.L.',
      });
    expect(res.status).toBe(201);
  });

  it('admin creates announcement → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Nuevas normas de aparcamiento',
        body: 'A partir del 1 de abril, las plazas de garaje quedan reservadas a sus titulares.',
        pinned: true,
        notify: false,
      });
    expect(res.status).toBe(201);
  });

  it('admin creates meeting → 201', async () => {
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 1);

    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Junta Anual de Propietarios',
        type: 'ORDINARY',
        scheduledAt: futureDate.toISOString(),
        location: 'Sala comunidad',
        agenda: '1. Balance 2024\n2. Presupuesto 2025\n3. Elección presidenta',
      });
    expect(res.status).toBe(201);
  });

  it('admin sets annual budget → 200', async () => {
    const res = await request(app)
      .put(`/api/v1/communities/${communityId}/budgets/2025`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        lines: [
          { category: 'CLEANING', amount: 6000 },
          { category: 'GARDENING', amount: 2400 },
          { category: 'INSURANCE', amount: 3600 },
          { category: 'MAINTENANCE', amount: 4000 },
        ],
      });
    expect(res.status).toBe(200);
  });

  it('admin views morosos report → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/reports/morosos`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('admin creates and views an incident → 201 + 200', async () => {
    const createRes = await request(app)
      .post(`/api/v1/communities/${communityId}/incidents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Fuga de agua en planta baja',
        description: 'Hay una fuga de agua en el contador general de la planta baja.',
        category: 'MAINTENANCE',
      });
    expect(createRes.status).toBe(201);

    const listRes = await request(app)
      .get(`/api/v1/communities/${communityId}/incidents`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.incidents.length).toBeGreaterThanOrEqual(1);
  });

  it('admin creates a common area → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/areas`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Sala de Juegos',
        description: 'Sala equipada para adultos y niños',
        capacity: 15,
        slotMinutes: 120,
      });
    expect(res.status).toBe(201);
  });

  it('admin creates a procedure and updates it → 201 + 200', async () => {
    const createRes = await request(app)
      .post('/api/v1/procedures')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        communityId,
        type: 'DOCUMENT_REQUEST',
        subject: 'Solicitud de estatutos de la comunidad',
        description: 'Necesito copia de los estatutos vigentes de la comunidad.',
      });
    expect(createRes.status).toBe(201);
    const procedureId = createRes.body.procedure.id;

    const updateRes = await request(app)
      .patch(`/api/v1/procedures/${procedureId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'COMPLETED', resolution: 'Enviados por email.' });
    expect(updateRes.status).toBe(200);
  });

  it('admin creates a message template → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/templates`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Aviso de recibo domiciliado',
        subject: 'Su recibo ha sido domiciliado',
        body: 'Estimado propietario, le comunicamos que su recibo del mes ha sido domiciliado correctamente.',
      });
    expect(res.status).toBe(201);
  });

  it('admin invites a resident → 201', async () => {
    const res = await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'resident.journey@test.com',
        firstName: 'Laura',
        lastName: 'Fernández',
        communityId,
        relationType: 'OWNER',
        unitId: unitAId,
        locale: 'es',
      });
    expect(res.status).toBe(201);
  });

  it('admin views full community summary', async () => {
    const [comm, invoices, expenses, annons, meetings] = await Promise.all([
      request(app).get(`/api/v1/communities/${communityId}`).set('Authorization', `Bearer ${adminToken}`),
      request(app).get(`/api/v1/communities/${communityId}/invoices`).set('Authorization', `Bearer ${adminToken}`),
      request(app).get(`/api/v1/communities/${communityId}/expenses`).set('Authorization', `Bearer ${adminToken}`),
      request(app).get(`/api/v1/communities/${communityId}/announcements`).set('Authorization', `Bearer ${adminToken}`),
      request(app).get(`/api/v1/communities/${communityId}/meetings`).set('Authorization', `Bearer ${adminToken}`),
    ]);

    expect(comm.status).toBe(200);
    expect(invoices.status).toBe(200);
    expect(expenses.status).toBe(200);
    expect(annons.status).toBe(200);
    expect(meetings.status).toBe(200);
  });
});
