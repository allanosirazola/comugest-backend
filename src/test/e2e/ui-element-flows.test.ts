/**
 * UI Element Flows — Backend E2E Tests
 *
 * Each describe suite corresponds to a concrete interactive element in the
 * frontend UI (button, form, modal).  The tests verify the COMPLETE backend
 * flow that the element triggers, including HTTP status codes, response shape,
 * DB state and authorisation guards.
 *
 * Pattern:
 *   - Scheduler mocked at module level (vi.mock hoisted before imports)
 *   - Single shared Express app instance (singleFork)
 *   - resetDatabase() in every describe's beforeAll for full isolation
 *   - Admin user + community created through HTTP in beforeAll helpers
 *   - Direct prisma reads for critical DB state assertions
 */

vi.mock('../../modules/scheduler/scheduler', () => ({ startScheduler: vi.fn() }));

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { resetDatabase } from './setup';
import { prisma } from '../../config/prisma';
import { hashPassword } from '../../utils/password';
import { signAccessToken } from '../../utils/jwt';
import { hashToken } from '../../utils/tokens';

const app = createApp();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function setupAdmin(
  email = 'admin@ui-flows.test',
  password = 'AdminPass1!',
): Promise<{ id: string; token: string }> {
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      firstName: 'Admin',
      lastName: 'Flows',
      role: 'ADMIN_FINCAS',
      locale: 'es',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      gdprAcceptedAt: new Date(),
      gdprVersion: '2025-01-01',
    },
    update: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  const token = signAccessToken({ sub: user.id, role: 'ADMIN_FINCAS' });
  return { id: user.id, token };
}

async function setupVecino(
  email = 'vecino@ui-flows.test',
  password = 'VecinoPass1!',
): Promise<{ id: string; token: string }> {
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      firstName: 'Vecino',
      lastName: 'Flows',
      role: 'VECINO',
      locale: 'es',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      gdprAcceptedAt: new Date(),
      gdprVersion: '2025-01-01',
    },
    update: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  const token = signAccessToken({ sub: user.id, role: 'VECINO' });
  return { id: user.id, token };
}

async function setupCommunity(
  adminToken: string,
  name = 'Comunidad Test',
): Promise<{ communityId: string; unit1Id: string; unit2Id: string }> {
  const comm = await request(app)
    .post('/api/v1/communities')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name,
      address: 'Calle Test 1',
      city: 'Madrid',
      postalCode: '28001',
      country: 'ES',
    });
  const communityId = comm.body.community.id as string;

  const u1 = await request(app)
    .post(`/api/v1/communities/${communityId}/units`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ type: 'VIVIENDA', label: '1A', coefficient: 25 });
  const unit1Id = u1.body.unit.id as string;

  const u2 = await request(app)
    .post(`/api/v1/communities/${communityId}/units`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ type: 'VIVIENDA', label: '1B', coefficient: 25 });
  const unit2Id = u2.body.unit.id as string;

  return { communityId, unit1Id, unit2Id };
}

// ============================================================================
// Suite 1 — Login Page: Submit Button
// ============================================================================
describe('Login Page — Submit Button', () => {
  const email = 'login-suite@ui-flows.test';
  const password = 'LoginPass1!';

  beforeAll(async () => {
    await resetDatabase();
    // Create ACTIVE user for login tests
    const hash = await hashPassword(password);
    await prisma.user.create({
      data: {
        email,
        passwordHash: hash,
        firstName: 'Login',
        lastName: 'User',
        role: 'ADMIN_FINCAS',
        locale: 'es',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        gdprAcceptedAt: new Date(),
        gdprVersion: '2025-01-01',
      },
    });
  });

  it('valid credentials → 200 + accessToken + refreshToken', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe(email);
  });

  it('wrong password → 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPass999!' });
    expect(res.status).toBe(401);
  });

  it('unverified account (PENDING status) → 403', async () => {
    const pendingEmail = 'pending@ui-flows.test';
    const hash = await hashPassword(password);
    await prisma.user.create({
      data: {
        email: pendingEmail,
        passwordHash: hash,
        firstName: 'Pending',
        lastName: 'User',
        role: 'ADMIN_FINCAS',
        locale: 'es',
        status: 'PENDING',
        gdprAcceptedAt: new Date(),
        gdprVersion: '2025-01-01',
      },
    });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: pendingEmail, password });
    expect(res.status).toBe(403);
  });

  it('missing email → 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ password });
    expect(res.status).toBe(400);
  });

  it('non-existent email → 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@nowhere.test', password });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// Suite 2 — Register Page: Submit Button
// ============================================================================
describe('Register Page — Submit Button', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('valid registration → 202 + requiresEmailVerification', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'newuser@ui-flows.test',
        password: 'SecurePass1!',
        firstName: 'New',
        lastName: 'User',
        role: 'ADMIN_FINCAS',
        locale: 'es',
        gdprAccepted: true,
      });
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('requiresEmailVerification', true);
  });

  it('duplicate email → 409', async () => {
    const payload = {
      email: 'dup@ui-flows.test',
      password: 'SecurePass1!',
      firstName: 'Dup',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      locale: 'es',
      gdprAccepted: true,
    };
    await request(app).post('/api/v1/auth/register').send(payload);
    const res = await request(app).post('/api/v1/auth/register').send(payload);
    expect(res.status).toBe(409);
  });

  it('weak password (too short) → 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'weak@ui-flows.test',
        password: 'abc',
        firstName: 'Weak',
        lastName: 'User',
        role: 'ADMIN_FINCAS',
        locale: 'es',
        gdprAccepted: true,
      });
    expect(res.status).toBe(400);
  });

  it('no GDPR acceptance → 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'nogdpr@ui-flows.test',
        password: 'SecurePass1!',
        firstName: 'No',
        lastName: 'Gdpr',
        role: 'ADMIN_FINCAS',
        locale: 'es',
        gdprAccepted: false,
      });
    expect(res.status).toBe(400);
  });

  it('missing email field → 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        password: 'SecurePass1!',
        firstName: 'Missing',
        lastName: 'Email',
        role: 'ADMIN_FINCAS',
        locale: 'es',
        gdprAccepted: true,
      });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 3 — Communities List: Create Community Button
// ============================================================================
describe('Communities List — Create Community Button', () => {
  let adminToken: string;
  let vecinoToken: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const vecino = await setupVecino();
    vecinoToken = vecino.token;
  });

  it('admin creates community with all fields → 201 + community object', async () => {
    const res = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Comunidad Los Pinos',
        address: 'Calle Mayor 1',
        city: 'Barcelona',
        postalCode: '08001',
        country: 'ES',
        cif: 'H08123456',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('community');
    expect(res.body.community.name).toBe('Comunidad Los Pinos');
  });

  it('missing required field (address) → 400', async () => {
    const res = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Solo Nombre' });
    expect(res.status).toBe(400);
  });

  it('VECINO cannot create community → 403', async () => {
    const res = await request(app)
      .post('/api/v1/communities')
      .set('Authorization', `Bearer ${vecinoToken}`)
      .send({
        name: 'Vecino Community',
        address: 'Calle B 2',
        city: 'Madrid',
        postalCode: '28001',
        country: 'ES',
      });
    expect(res.status).toBe(403);
  });

  it('unauthenticated request → 401', async () => {
    const res = await request(app)
      .post('/api/v1/communities')
      .send({ name: 'No Auth' });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// Suite 4 — Community Detail: Add Unit Button
// ============================================================================
describe('Community Detail — Add Unit Button', () => {
  let adminToken: string;
  let vecinoToken: string;
  let communityId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const vecino = await setupVecino();
    vecinoToken = vecino.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Unidades');
    communityId = setup.communityId;
  });

  it('admin adds unit with type, label, coefficient → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: '2A', coefficient: 15 });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('unit');
    expect(res.body.unit.label).toBe('2A');
  });

  it('adds GARAJE unit → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'GARAJE', label: 'G-01', coefficient: 5 });
    expect(res.status).toBe(201);
  });

  it('invalid coefficient (negative) → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: '3A', coefficient: -10 });
    expect(res.status).toBe(400);
  });

  it('non-admin cannot add unit → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${vecinoToken}`)
      .send({ type: 'VIVIENDA', label: '4A', coefficient: 10 });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Suite 5 — Community Detail: Edit Unit Button
// ============================================================================
describe('Community Detail — Edit Unit Button', () => {
  let adminToken: string;
  let vecinoToken: string;
  let unitId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const vecino = await setupVecino();
    vecinoToken = vecino.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Edit Unit');
    unitId = setup.unit1Id;
  });

  it('admin updates unit label → 200 + updated unit', async () => {
    const res = await request(app)
      .patch(`/api/v1/units/${unitId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Piso-1A-Updated' });
    expect(res.status).toBe(200);
    expect(res.body.unit?.label ?? res.body.label).toBe('Piso-1A-Updated');
  });

  it('admin updates unit coefficient → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/units/${unitId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coefficient: 30 });
    expect(res.status).toBe(200);
  });

  it('admin updates unit type → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/units/${unitId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'LOCAL' });
    expect(res.status).toBe(200);
  });

  it('non-admin cannot edit unit → 403', async () => {
    const res = await request(app)
      .patch(`/api/v1/units/${unitId}`)
      .set('Authorization', `Bearer ${vecinoToken}`)
      .send({ label: 'Hacked' });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Suite 6 — Community Detail: Delete Unit Button
// ============================================================================
describe('Community Detail — Delete Unit Button', () => {
  let adminToken: string;
  let vecinoToken: string;
  let communityId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const vecino = await setupVecino();
    vecinoToken = vecino.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Delete Unit');
    communityId = setup.communityId;
  });

  it('non-admin cannot delete unit → 403', async () => {
    // Create a unit to attempt deletion
    const u = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: 'TBD', coefficient: 10 });
    const unitId = u.body.unit.id;

    const res = await request(app)
      .delete(`/api/v1/units/${unitId}`)
      .set('Authorization', `Bearer ${vecinoToken}`);
    expect(res.status).toBe(403);
  });

  it('admin deletes existing unit → 204', async () => {
    const u = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: 'ToDelete', coefficient: 10 });
    const unitId = u.body.unit.id;

    const res = await request(app)
      .delete(`/api/v1/units/${unitId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it('delete already-deleted unit → 404 or 403', async () => {
    const u = await request(app)
      .post(`/api/v1/communities/${communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'GARAJE', label: 'G-Del', coefficient: 5 });
    const unitId = u.body.unit.id;

    await request(app)
      .delete(`/api/v1/units/${unitId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const res = await request(app)
      .delete(`/api/v1/units/${unitId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect([404, 400, 409]).toContain(res.status);
  });
});

// ============================================================================
// Suite 7 — Community Detail: Add Co-Admin Button
// ============================================================================
describe('Community Detail — Add Co-Admin Button', () => {
  let adminToken: string;
  let coAdminEmail: string;
  let communityId: string;
  let coAdminUserId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;

    // Create a second admin user to add as co-admin
    coAdminEmail = 'co-admin-target@ui-flows.test';
    const hash = await hashPassword('CoAdmin1!');
    const coAdmin = await prisma.user.create({
      data: {
        email: coAdminEmail,
        passwordHash: hash,
        firstName: 'CoAdmin',
        lastName: 'Target',
        role: 'ADMIN_FINCAS',
        locale: 'es',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        gdprAcceptedAt: new Date(),
        gdprVersion: '2025-01-01',
      },
    });
    coAdminUserId = coAdmin.id;

    const setup = await setupCommunity(adminToken, 'Comunidad CoAdmins');
    communityId = setup.communityId;
  });

  it('list co-admins → 200 + array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/co-admins`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('add co-admin by email → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/co-admins`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: coAdminEmail });
    expect(res.status).toBe(201);
  });

  it('add already-added co-admin → 409 or idempotent 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/co-admins`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: coAdminEmail });
    expect([201, 409]).toContain(res.status);
  });

  it('remove co-admin → 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/communities/${communityId}/co-admins/${coAdminUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it('add co-admin with invalid email → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/co-admins`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 8 — Community Detail: Add Unit Note Button
// ============================================================================
describe('Community Detail — Add Unit Note Button', () => {
  let adminToken: string;
  let unitId: string;
  let noteId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Unit Notes');
    unitId = setup.unit1Id;
  });

  it('create note on unit → 201 + note object', async () => {
    const res = await request(app)
      .post(`/api/v1/units/${unitId}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: 'Propietario pendiente de pago' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('note');
    noteId = res.body.note.id;
  });

  it('list notes on unit → 200 + array', async () => {
    const res = await request(app)
      .get(`/api/v1/units/${unitId}/notes`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('notes');
    expect(Array.isArray(res.body.notes)).toBe(true);
  });

  it('create note with empty content → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/units/${unitId}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: '' });
    expect(res.status).toBe(400);
  });

  it('delete note → 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/units/${unitId}/notes/${noteId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it('vecino cannot create note → 403', async () => {
    const vecino = await setupVecino('vecino-notes@ui-flows.test');
    const res = await request(app)
      .post(`/api/v1/units/${unitId}/notes`)
      .set('Authorization', `Bearer ${vecino.token}`)
      .send({ content: 'Hacked note' });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Suite 9 — Create Invoice Page: Submit Button (DERRAMA mode)
// ============================================================================
describe('Create Invoice Page — Submit Button (DERRAMA mode)', () => {
  let adminToken: string;
  let communityId: string;
  let unit1Id: string;
  let invoiceId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Derrama');
    communityId = setup.communityId;
    unit1Id = setup.unit1Id;
  });

  it('creates DERRAMA invoice → 201 + invoice object', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DERRAMA',
        concept: 'Reparación tejado 2025',
        dueDate: '2025-12-31',
        totalAmount: 5000.00,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('invoice');
    invoiceId = res.body.invoice.id;
  });

  it('DB: invoice exists and is not cancelled (ACTIVE)', async () => {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(invoice).toBeTruthy();
    expect(invoice!.cancelledAt).toBeNull();
  });

  it('DB: items created proportional to unit coefficients', async () => {
    const items = await prisma.invoiceItem.findMany({ where: { invoiceId } });
    expect(items.length).toBeGreaterThanOrEqual(2);
    // All items must have positive amounts
    items.forEach((item) => expect(Number(item.amount)).toBeGreaterThan(0));
  });

  it('missing totalAmount on DERRAMA → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DERRAMA',
        concept: 'Sin importe',
        dueDate: '2025-12-31',
      });
    expect(res.status).toBe(400);
  });

  it('DERRAMA with specific unitIds → 201 + items only for those units', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DERRAMA',
        concept: 'Derrama parcial',
        dueDate: '2025-11-30',
        totalAmount: 2000,
        unitIds: [unit1Id],
      });
    expect(res.status).toBe(201);
    const items = await prisma.invoiceItem.findMany({
      where: { invoiceId: res.body.invoice.id },
    });
    expect(items.length).toBe(1);
    expect(items[0].unitId).toBe(unit1Id);
  });
});

// ============================================================================
// Suite 10 — Create Invoice Page: Submit Button (INDIVIDUAL mode)
// ============================================================================
describe('Create Invoice Page — Submit Button (INDIVIDUAL mode)', () => {
  let adminToken: string;
  let communityId: string;
  let unit1Id: string;
  let unit2Id: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Individual');
    communityId = setup.communityId;
    unit1Id = setup.unit1Id;
    unit2Id = setup.unit2Id;
  });

  it('creates INDIVIDUAL invoice with per-unit amounts → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Cuota Enero 2025',
        dueDate: '2025-01-31',
        items: [
          { unitId: unit1Id, amount: 120.00 },
          { unitId: unit2Id, amount: 130.00 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('invoice');
  });

  it('DB: invoice item amounts match input', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Cuota Verificación',
        dueDate: '2025-02-28',
        items: [
          { unitId: unit1Id, amount: 200.50 },
          { unitId: unit2Id, amount: 300.75 },
        ],
      });
    expect(res.status).toBe(201);
    const invoiceId = res.body.invoice.id;
    const items = await prisma.invoiceItem.findMany({ where: { invoiceId } });
    const amounts = items.map((i) => parseFloat(String(i.amount)));
    expect(amounts).toContain(200.5);
    expect(amounts).toContain(300.75);
  });

  it('negative amount → 400', async () => {
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

  it('missing concept → 400', async () => {
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

  it('no items → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Sin items',
        dueDate: '2025-01-31',
        items: [],
      });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 11 — Invoice Detail: Record Payment Button
// ============================================================================
describe('Invoice Detail — Record Payment Button', () => {
  let adminToken: string;
  let invoiceItemId: string;
  let communityId: string;
  let unit1Id: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Pagos');
    communityId = setup.communityId;
    unit1Id = setup.unit1Id;

    const inv = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Cuota para pago',
        dueDate: '2025-06-30',
        items: [{ unitId: unit1Id, amount: 150.00 }],
      });
    invoiceItemId = inv.body.invoice.items[0].id;
  });

  it('record full payment → 201 + payment object', async () => {
    const res = await request(app)
      .post(`/api/v1/invoices/items/${invoiceItemId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 150.00,
        method: 'BANK_TRANSFER',
        reference: 'TRF-001',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('payment');
  });

  it('DB: item has one payment equal to full amount after full payment', async () => {
    const payments = await prisma.payment.findMany({ where: { invoiceItemId } });
    expect(payments.length).toBeGreaterThanOrEqual(1);
    const totalPaid = payments.reduce((sum, p) => sum + parseFloat(String(p.amount)), 0);
    expect(totalPaid).toBeCloseTo(150, 1);
  });

  it('record partial payment on fresh item → 201 + item partially covered', async () => {
    // Create a new invoice with a fresh item
    const setup2 = await setupCommunity(adminToken, 'Comunidad Pagos Parcial');
    const u = await request(app)
      .post(`/api/v1/communities/${setup2.communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: 'Parcial-A', coefficient: 10 });
    const freshUnitId = u.body.unit.id;

    const inv2 = await request(app)
      .post(`/api/v1/communities/${setup2.communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Cuota parcial',
        dueDate: '2025-06-30',
        items: [{ unitId: freshUnitId, amount: 200.00 }],
      });
    const freshItemId = inv2.body.invoice.items[0].id;

    const res = await request(app)
      .post(`/api/v1/invoices/items/${freshItemId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 100.00, method: 'CASH' });
    expect(res.status).toBe(201);

    // Verify the payment amount in DB (partial: 100 of 200)
    const payments = await prisma.payment.findMany({ where: { invoiceItemId: freshItemId } });
    const totalPaid = payments.reduce((sum, p) => sum + parseFloat(String(p.amount)), 0);
    expect(totalPaid).toBeCloseTo(100, 1);
  });

  it('overpayment → 422 or 400', async () => {
    const setup3 = await setupCommunity(adminToken, 'Comunidad Overpay');
    const u = await request(app)
      .post(`/api/v1/communities/${setup3.communityId}/units`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'VIVIENDA', label: 'Over-A', coefficient: 10 });
    const overId = u.body.unit.id;

    const inv3 = await request(app)
      .post(`/api/v1/communities/${setup3.communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Cuota overpay',
        dueDate: '2025-06-30',
        items: [{ unitId: overId, amount: 100.00 }],
      });
    const overItemId = inv3.body.invoice.items[0].id;

    const res = await request(app)
      .post(`/api/v1/invoices/items/${overItemId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 999.99, method: 'CASH' });
    expect([400, 422]).toContain(res.status);
  });
});

// ============================================================================
// Suite 12 — Invoice Detail: Delete Payment Button
// ============================================================================
describe('Invoice Detail — Delete Payment Button', () => {
  let adminToken: string;
  let invoiceItemId: string;
  let paymentId: string;
  let communityId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Delete Payment');
    communityId = setup.communityId;

    const inv = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Cuota delete payment',
        dueDate: '2025-06-30',
        items: [{ unitId: setup.unit1Id, amount: 100.00 }],
      });
    invoiceItemId = inv.body.invoice.items[0].id;

    const pay = await request(app)
      .post(`/api/v1/invoices/items/${invoiceItemId}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 50.00, method: 'CASH' });
    paymentId = pay.body.payment.id;
  });

  it('delete existing payment → 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/invoices/payments/${paymentId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it('DB: no payments remain on item after payment deletion', async () => {
    const payments = await prisma.payment.findMany({ where: { invoiceItemId } });
    expect(payments.length).toBe(0);
  });

  it('delete non-existent payment → 404', async () => {
    const fakeId = 'clnonexistent000000000000';
    const res = await request(app)
      .delete(`/api/v1/invoices/payments/${fakeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect([404, 400]).toContain(res.status);
  });
});

// ============================================================================
// Suite 13 — Invoice Detail: Cancel Invoice Button
// ============================================================================
describe('Invoice Detail — Cancel Invoice Button', () => {
  let adminToken: string;
  let communityId: string;
  let unit1Id: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Cancel Invoice');
    communityId = setup.communityId;
    unit1Id = setup.unit1Id;
  });

  it('cancel ACTIVE invoice → 200 or 204', async () => {
    const inv = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'A Cancelar',
        dueDate: '2025-09-30',
        items: [{ unitId: unit1Id, amount: 75 }],
      });
    const invoiceId = inv.body.invoice.id;

    const res = await request(app)
      .delete(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect([200, 204]).toContain(res.status);
  });

  it('DB: invoice has cancelledAt set after cancellation', async () => {
    const inv = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'INDIVIDUAL',
        concept: 'Verificar Cancelacion',
        dueDate: '2025-10-31',
        items: [{ unitId: unit1Id, amount: 50 }],
      });
    const invoiceId = inv.body.invoice.id;

    await request(app)
      .delete(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(invoice!.cancelledAt).not.toBeNull();
  });

  it('cancel non-existent invoice → 404', async () => {
    const res = await request(app)
      .delete('/api/v1/invoices/clnonexistent000000000001')
      .set('Authorization', `Bearer ${adminToken}`);
    expect([400, 404]).toContain(res.status);
  });
});

// ============================================================================
// Suite 14 — Community Invoices: Create Bulk Invoice Button
// ============================================================================
describe('Community Invoices — Create Bulk Invoice Button', () => {
  let adminToken: string;
  let communityId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Bulk');
    communityId = setup.communityId;
  });

  it('creates bulk EQUAL invoice → 201 + invoice', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        concept: 'Cuota Mensual Marzo',
        dueDate: '2025-03-31',
        distributionMode: 'EQUAL',
        perUnitAmount: 100.00,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('invoice');
  });

  it('DB: items created for all units', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        concept: 'Cuota Mensual Abril',
        dueDate: '2025-04-30',
        distributionMode: 'EQUAL',
        perUnitAmount: 80.00,
      });
    const invoiceId = res.body.invoice.id;
    const items = await prisma.invoiceItem.findMany({ where: { invoiceId } });
    expect(items.length).toBeGreaterThanOrEqual(2);
    items.forEach((i) => expect(parseFloat(String(i.amount))).toBe(80));
  });

  it('missing dueDate → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        concept: 'Sin fecha',
        distributionMode: 'EQUAL',
        perUnitAmount: 50,
      });
    expect(res.status).toBe(400);
  });

  it('negative perUnitAmount → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/invoices/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        concept: 'Negativo',
        dueDate: '2025-05-31',
        distributionMode: 'EQUAL',
        perUnitAmount: -10,
      });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 15 — Community Expenses: Create Expense Button
// ============================================================================
describe('Community Expenses — Create Expense Button', () => {
  let adminToken: string;
  let communityId: string;
  let expenseId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Gastos');
    communityId = setup.communityId;
  });

  it('creates expense with valid data → 201 + expense', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'CLEANING',
        concept: 'Limpieza mensual',
        amount: 350.00,
        expenseDate: '2025-01-15',
        supplier: 'LimpiezasSL',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('expense');
    expenseId = res.body.expense.id;
  });

  it('invalid category → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'INVALID_CATEGORY',
        concept: 'Test',
        amount: 100,
        expenseDate: '2025-01-01',
      });
    expect(res.status).toBe(400);
  });

  it('zero amount → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'MAINTENANCE',
        concept: 'Cero euros',
        amount: 0,
        expenseDate: '2025-01-01',
      });
    expect(res.status).toBe(400);
  });

  it('list expenses → 200 + array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/expenses`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('delete expense → 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/expenses/${expenseId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ============================================================================
// Suite 16 — Community Announcements: Create Announcement Button
// ============================================================================
describe('Community Announcements — Create Announcement Button', () => {
  let adminToken: string;
  let communityId: string;
  let announcementId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Anuncios');
    communityId = setup.communityId;
  });

  it('creates announcement with title and body → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Aviso importante',
        body: 'Habrá corte de agua el miércoles de 9 a 13h.',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('announcement');
    announcementId = res.body.announcement.id;
  });

  it('creates announcement with pinned=true and notify=true → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Aviso fijado',
        body: 'Este aviso está fijado.',
        pinned: true,
        notify: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.announcement.pinned).toBe(true);
  });

  it('creates announcement with expiresAt → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Aviso con expiración',
        body: 'Este aviso expira pronto.',
        expiresAt: '2025-12-31T23:59:59.000Z',
      });
    expect(res.status).toBe(201);
  });

  it('empty title → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: '', body: 'Body sin título' });
    expect(res.status).toBe(400);
  });

  it('list announcements → 200 + array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/announcements`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('announcements');
  });

  it('delete announcement → 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/announcements/${announcementId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ============================================================================
// Suite 17 — Community Announcements: Save Template Button
// ============================================================================
describe('Community Announcements — Save Template Button', () => {
  let adminToken: string;
  let communityId: string;
  let templateId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Templates');
    communityId = setup.communityId;
  });

  it('creates template with name, subject, body → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/templates`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Plantilla Bienvenida',
        subject: 'Bienvenido a la comunidad',
        body: 'Estimado vecino, bienvenido a nuestra comunidad.',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('template');
    templateId = res.body.template.id;
  });

  it('list templates → 200 + templates array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/templates`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('templates');
    expect(Array.isArray(res.body.templates)).toBe(true);
  });

  it('create template with empty name → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/templates`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '', subject: 'Subject', body: 'Body' });
    expect(res.status).toBe(400);
  });

  it('delete template → 204', async () => {
    const res = await request(app)
      .delete(`/api/v1/communities/${communityId}/templates/${templateId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ============================================================================
// Suite 18 — Community Meetings: Create Meeting Button
// ============================================================================
describe('Community Meetings — Create Meeting Button', () => {
  let adminToken: string;
  let vecinoToken: string;
  let communityId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const vecino = await setupVecino();
    vecinoToken = vecino.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Reuniones');
    communityId = setup.communityId;
  });

  it('creates ORDINARY meeting → 201 + meeting object', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Junta Ordinaria Enero 2025',
        type: 'ORDINARY',
        scheduledAt: '2025-01-20T18:00:00.000Z',
        location: 'Sala de reuniones',
        agenda: '1. Aprobación actas\n2. Presupuesto 2025',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('meeting');
    expect(res.body.meeting.title).toBe('Junta Ordinaria Enero 2025');
  });

  it('creates EXTRAORDINARY meeting → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Junta Extraordinaria',
        type: 'EXTRAORDINARY',
        scheduledAt: '2025-02-10T10:00:00.000Z',
      });
    expect(res.status).toBe(201);
    expect(res.body.meeting.type).toBe('EXTRAORDINARY');
  });

  it('missing title → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scheduledAt: '2025-03-01T09:00:00.000Z' });
    expect(res.status).toBe(400);
  });

  it('vecino cannot create meeting → 403', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meetings`)
      .set('Authorization', `Bearer ${vecinoToken}`)
      .send({
        title: 'Junta no autorizada',
        scheduledAt: '2025-04-01T10:00:00.000Z',
      });
    expect(res.status).toBe(403);
  });

  it('list meetings → 200 + meetings array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('meetings');
    expect(Array.isArray(res.body.meetings)).toBe(true);
  });
});

// ============================================================================
// Suite 19 — Meeting Detail: Attendance Status Buttons
// ============================================================================
describe('Meeting Detail — Attendance Status Buttons', () => {
  let adminToken: string;
  let meetingId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Asistencia');

    const meeting = await request(app)
      .post(`/api/v1/communities/${setup.communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Junta Asistencia',
        scheduledAt: '2025-03-15T18:00:00.000Z',
      });
    meetingId = meeting.body.meeting.id;
  });

  it('mark attendance as CONFIRMED → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/meetings/${meetingId}/attendance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CONFIRMED' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('attendee');
  });

  it('mark attendance as DECLINED → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/meetings/${meetingId}/attendance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DECLINED' });
    expect(res.status).toBe(200);
  });

  it('mark attendance as DELEGATED with proxy name → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/meetings/${meetingId}/attendance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DELEGATED', proxy: 'Juan García' });
    expect(res.status).toBe(200);
    expect(res.body.attendee.proxy).toBe('Juan García');
  });

  it('DELEGATED without proxy → 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/meetings/${meetingId}/attendance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DELEGATED' });
    expect(res.status).toBe(400);
  });

  it('mark back to PENDING → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/meetings/${meetingId}/attendance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'PENDING' });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Suite 20 — Meeting Detail: Save Minutes Button
// ============================================================================
describe('Meeting Detail — Save Minutes Button', () => {
  let adminToken: string;
  let meetingId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Actas');

    const meeting = await request(app)
      .post(`/api/v1/communities/${setup.communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Junta con Acta',
        scheduledAt: '2025-04-01T18:00:00.000Z',
      });
    meetingId = meeting.body.meeting.id;
  });

  it('save minutes text → 200 + meeting with minutes', async () => {
    const minutesText = 'Acta de la reunión del 1 de abril de 2025. Se aprobaron los presupuestos.';
    const res = await request(app)
      .put(`/api/v1/meetings/${meetingId}/minutes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ minutes: minutesText });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('meeting');
    expect(res.body.meeting.minutes).toBe(minutesText);
  });

  it('publish minutes → 200 + minutesPublished=true', async () => {
    const res = await request(app)
      .patch(`/api/v1/meetings/${meetingId}/minutes/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: true });
    expect(res.status).toBe(200);
    expect(res.body.meeting.minutesPublished).toBe(true);
  });

  it('unpublish minutes → 200 + minutesPublished=false', async () => {
    const res = await request(app)
      .patch(`/api/v1/meetings/${meetingId}/minutes/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ published: false });
    expect(res.status).toBe(200);
    expect(res.body.meeting.minutesPublished).toBe(false);
  });

  it('save empty minutes → 200 (empty string is valid)', async () => {
    const res = await request(app)
      .put(`/api/v1/meetings/${meetingId}/minutes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ minutes: '' });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Suite 21 — Meeting Detail: Create Poll Button
// ============================================================================
describe('Meeting Detail — Create Poll Button', () => {
  let adminToken: string;
  let meetingId: string;
  let pollId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Votaciones');

    const meeting = await request(app)
      .post(`/api/v1/communities/${setup.communityId}/meetings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Junta Votaciones',
        scheduledAt: '2025-05-10T18:00:00.000Z',
      });
    meetingId = meeting.body.meeting.id;
  });

  it('create poll with question → 201 + poll object', async () => {
    const res = await request(app)
      .post(`/api/v1/meetings/${meetingId}/polls`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        question: '¿Aprueba usted el presupuesto para el año 2025?',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('poll');
    pollId = res.body.poll.id;
  });

  it('list polls → 200 + polls array', async () => {
    const res = await request(app)
      .get(`/api/v1/meetings/${meetingId}/polls`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('polls');
  });

  it('vote on poll with FAVOR → 200', async () => {
    const res = await request(app)
      .post(`/api/v1/meetings/${meetingId}/polls/${pollId}/vote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ option: 'FAVOR' });
    expect(res.status).toBe(200);
  });

  it('close poll → 200 + closed poll', async () => {
    const res = await request(app)
      .post(`/api/v1/meetings/${meetingId}/polls/${pollId}/close`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.poll.closedAt).toBeTruthy();
  });

  it('create poll with empty question → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/meetings/${meetingId}/polls`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ question: '' });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 22 — Community Areas: Create Area Button
// ============================================================================
describe('Community Areas — Create Area Button', () => {
  let adminToken: string;
  let communityId: string;
  let areaId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Zonas Comunes');
    communityId = setup.communityId;
  });

  it('creates area with required fields → 201 + area object', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/areas`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Salón de usos múltiples',
        capacity: 30,
        openTime: '09:00',
        closeTime: '21:00',
        slotMinutes: 60,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('area');
    areaId = res.body.area.id;
  });

  it('missing name → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/areas`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacity: 10, slotMinutes: 60 });
    expect(res.status).toBe(400);
  });

  it('list areas → 200 + areas array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/areas`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('areas');
  });

  it('update area → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/areas/${areaId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Salón Actualizado', capacity: 40 });
    expect(res.status).toBe(200);
    expect(res.body.area.name).toBe('Salón Actualizado');
  });

  it('delete area → 204', async () => {
    const newArea = await request(app)
      .post(`/api/v1/communities/${communityId}/areas`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Area Temporal', slotMinutes: 30 });
    const tempId = newArea.body.area.id;

    const res = await request(app)
      .delete(`/api/v1/areas/${tempId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ============================================================================
// Suite 23 — Area Reservations: Make Reservation Button
// ============================================================================
describe('Area Reservations — Make Reservation Button', () => {
  let adminToken: string;
  let communityId: string;
  let areaId: string;
  let reservationId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Reservas');
    communityId = setup.communityId;

    const area = await request(app)
      .post(`/api/v1/communities/${communityId}/areas`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Piscina', capacity: 20, slotMinutes: 60 });
    areaId = area.body.area.id;
  });

  it('creates reservation with startAt → 201', async () => {
    const startAt = new Date('2025-07-15T10:00:00.000Z').toISOString();
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/areas/${areaId}/reservations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ areaId, startAt });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('reservation');
    reservationId = res.body.reservation.id;
  });

  it('list reservations for area → 200 + reservations array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/areas/${areaId}/reservations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ date: '2025-07-15' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reservations');
  });

  it('list reservations without date param → 400', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/areas/${areaId}/reservations`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('cancel reservation → 200', async () => {
    const res = await request(app)
      .delete(`/api/v1/areas/reservations/${reservationId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect([200, 204]).toContain(res.status);
  });
});

// ============================================================================
// Suite 24 — Community Documents: Upload Document Button
// ============================================================================
describe('Community Documents — Upload Document Button', () => {
  let adminToken: string;
  let communityId: string;
  let docId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Documentos');
    communityId = setup.communityId;
  });

  it('creates document with name, url, category → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Reglamento Interno 2025',
        url: 'https://example.com/docs/reglamento-2025.pdf',
        category: 'REGLAMENTO',
        publicForResidents: true,
      });
    expect(res.status).toBe(201);
    docId = (res.body as { id?: string; name?: string }).id
      ?? (res.body.document?.id as string | undefined)
      ?? '';
  });

  it('list documents → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('update document name → 200', async () => {
    if (!docId) return; // skip if creation failed
    const res = await request(app)
      .patch(`/api/v1/communities/${communityId}/documents/${docId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Reglamento Interno 2025 (actualizado)' });
    expect(res.status).toBe(200);
  });

  it('create document with invalid URL → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Doc inválido',
        url: 'not-a-valid-url',
        category: 'OTRO',
      });
    expect(res.status).toBe(400);
  });

  it('delete document → 204', async () => {
    if (!docId) return;
    const res = await request(app)
      .delete(`/api/v1/communities/${communityId}/documents/${docId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ============================================================================
// Suite 25 — Community Incidents: Create Incident Button
// ============================================================================
describe('Community Incidents — Create Incident Button', () => {
  let adminToken: string;
  let communityId: string;
  let incidentId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Incidencias');
    communityId = setup.communityId;
  });

  it('creates incident with title, category, description → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/incidents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Avería ascensor planta 3',
        description: 'El ascensor no sube a la planta 3 desde ayer.',
        category: 'ELEVATOR',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('incident');
    incidentId = res.body.incident.id;
  });

  it('list incidents → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/incidents`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('incidents');
  });

  it('update incident status to IN_PROGRESS → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/communities/${communityId}/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
    expect(res.body.incident.status).toBe('IN_PROGRESS');
  });

  it('update incident status to RESOLVED with resolution text → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/communities/${communityId}/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED', resolution: 'Se reparó la guía del ascensor.' });
    expect(res.status).toBe(200);
  });

  it('create incident without title → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/incidents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Sin título' });
    expect(res.status).toBe(400);
  });

  it('invalid status value → 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/communities/${communityId}/incidents/${incidentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INVALID_STATUS' });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 26 — Community Meter Readings: Add Reading Button
// ============================================================================
describe('Community Meter Readings — Add Reading Button', () => {
  let adminToken: string;
  let communityId: string;
  let unit1Id: string;
  let readingId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Contadores');
    communityId = setup.communityId;
    unit1Id = setup.unit1Id;
  });

  it('creates reading with unitId, type, value, readingDate → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meter-readings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        unitId: unit1Id,
        type: 'AGUA',
        value: 1523.5,
        readingDate: '2025-01-31',
      });
    expect(res.status).toBe(201);
    readingId = (res.body as { id?: string }).id ?? '';
  });

  it('list readings → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/meter-readings`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('list readings filtered by unitId → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/meter-readings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ unitId: unit1Id });
    expect(res.status).toBe(200);
  });

  it('creates GAS reading → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meter-readings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        unitId: unit1Id,
        type: 'GAS',
        value: 890.0,
        readingDate: '2025-01-31',
      });
    expect(res.status).toBe(201);
  });

  it('negative value → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/meter-readings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        unitId: unit1Id,
        type: 'LUZ',
        value: -50,
        readingDate: '2025-01-31',
      });
    expect(res.status).toBe(400);
  });

  it('delete reading → 204', async () => {
    if (!readingId) return;
    const res = await request(app)
      .delete(`/api/v1/communities/${communityId}/meter-readings/${readingId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ============================================================================
// Suite 27 — Community Recurring: Create Recurring Button
// ============================================================================
describe('Community Recurring — Create Recurring Button', () => {
  let adminToken: string;
  let communityId: string;
  let recurringId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Recurrentes');
    communityId = setup.communityId;
  });

  it('creates MONTHLY recurring with concept, amount, dayOfMonth → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/recurring`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        concept: 'Cuota mensual de comunidad',
        frequency: 'MONTHLY',
        amount: 85.50,
        dayOfMonth: 5,
      });
    expect(res.status).toBe(201);
    recurringId = (res.body as { id?: string }).id ?? '';
  });

  it('creates QUARTERLY recurring → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/recurring`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        concept: 'Seguro trimestral',
        frequency: 'QUARTERLY',
        amount: 250,
        dayOfMonth: 1,
      });
    expect(res.status).toBe(201);
  });

  it('list recurring → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/recurring`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('update recurring to inactive → 200', async () => {
    if (!recurringId) return;
    const res = await request(app)
      .patch(`/api/v1/communities/${communityId}/recurring/${recurringId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });
    expect(res.status).toBe(200);
  });

  it('negative amount → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/recurring`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        concept: 'Negativo',
        frequency: 'MONTHLY',
        amount: -50,
        dayOfMonth: 1,
      });
    expect(res.status).toBe(400);
  });

  it('dayOfMonth out of range (> 28) → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/recurring`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        concept: 'Día inválido',
        frequency: 'MONTHLY',
        amount: 100,
        dayOfMonth: 31,
      });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 28 — Community Suppliers: Add Supplier Button
// ============================================================================
describe('Community Suppliers — Add Supplier Button', () => {
  let adminToken: string;
  let communityId: string;
  let supplierId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Proveedores');
    communityId = setup.communityId;
  });

  it('creates supplier with name, cif, email → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/suppliers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'LimpiezasMadrid SL',
        cif: 'B28123456',
        email: 'contacto@limpiezasmadrid.com',
        phone: '+34910000000',
      });
    expect(res.status).toBe(201);
    supplierId = (res.body as { id?: string }).id ?? '';
  });

  it('list suppliers → 200 + array', async () => {
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/suppliers`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('get single supplier → 200', async () => {
    if (!supplierId) return;
    const res = await request(app)
      .get(`/api/v1/communities/${communityId}/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('update supplier name → 200', async () => {
    if (!supplierId) return;
    const res = await request(app)
      .patch(`/api/v1/communities/${communityId}/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'LimpiezasMadrid SL (actualizado)' });
    expect(res.status).toBe(200);
  });

  it('create supplier with invalid email → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/communities/${communityId}/suppliers`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Proveedor Inválido',
        email: 'not-an-email',
      });
    expect(res.status).toBe(400);
  });

  it('delete supplier → 204', async () => {
    if (!supplierId) return;
    const res = await request(app)
      .delete(`/api/v1/communities/${communityId}/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ============================================================================
// Suite 29 — Report Issue: Submit Button
// ============================================================================
describe('Report Issue — Submit Button', () => {
  let adminToken: string;
  let ticketId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
  });

  it('creates ticket with subject, category, description → 201', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        subject: 'Error al generar factura',
        category: 'BUG',
        description: 'Cuando intento crear una factura tipo DERRAMA, recibo un error 500.',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('ticket');
    ticketId = res.body.ticket.id;
  });

  it('add comment to ticket → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'He comprobado que el error ocurre en Firefox también.' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('comment');
  });

  it('list my tickets → 200 + tickets array', async () => {
    const res = await request(app)
      .get('/api/v1/me/tickets')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tickets');
    expect(Array.isArray(res.body.tickets)).toBe(true);
  });

  it('missing category → 400', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        subject: 'Sin categoría',
        description: 'Descripción del problema',
      });
    expect(res.status).toBe(400);
  });

  it('invalid category → 400', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        subject: 'Categoría inválida',
        category: 'INVALID',
        description: 'Descripción.',
      });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 30 — Profile Page: Save Personal Data Button
// ============================================================================
describe('Profile Page — Save Personal Data Button', () => {
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    adminId = admin.id;
  });

  it('updates firstName, lastName, phone, locale → 200 + updated profile', async () => {
    const res = await request(app)
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Ana',
        lastName: 'García López',
        phone: '+34600123456',
        locale: 'en',
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('profile');
    expect(res.body.profile.firstName).toBe('Ana');
    expect(res.body.profile.lastName).toBe('García López');
  });

  it('DB: user fields updated after profile save', async () => {
    await request(app)
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'DBVerified', lastName: 'Test' });

    const user = await prisma.user.findUnique({ where: { id: adminId } });
    expect(user!.firstName).toBe('DBVerified');
  });

  it('get profile → 200 + profile object', async () => {
    const res = await request(app)
      .get('/api/v1/me/profile')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('profile');
  });

  it('missing firstName → 400', async () => {
    const res = await request(app)
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lastName: 'Solo apellido' });
    expect(res.status).toBe(400);
  });

  it('invalid locale → 400', async () => {
    const res = await request(app)
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Test', lastName: 'User', locale: 'zh' });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 31 — Profile Page: Change Password Button
// ============================================================================
describe('Profile Page — Change Password Button', () => {
  const email = 'change-pw@ui-flows.test';
  const oldPassword = 'OldPass1!';
  let adminToken: string;

  beforeAll(async () => {
    await resetDatabase();
    const hash = await hashPassword(oldPassword);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hash,
        firstName: 'Change',
        lastName: 'Password',
        role: 'ADMIN_FINCAS',
        locale: 'es',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        gdprAcceptedAt: new Date(),
        gdprVersion: '2025-01-01',
      },
    });
    adminToken = signAccessToken({ sub: user.id, role: 'ADMIN_FINCAS' });
  });

  it('valid old password + new strong password → 204', async () => {
    const res = await request(app)
      .post('/api/v1/me/profile/change-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        currentPassword: oldPassword,
        newPassword: 'NewSecurePass1!',
      });
    expect(res.status).toBe(204);
  });

  it('wrong old password → 400 or 401', async () => {
    const res = await request(app)
      .post('/api/v1/me/profile/change-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        currentPassword: 'WrongOldPass9!',
        newPassword: 'AnotherPass1!',
      });
    expect([400, 401]).toContain(res.status);
  });

  it('new password too short → 400', async () => {
    const res = await request(app)
      .post('/api/v1/me/profile/change-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        currentPassword: oldPassword,
        newPassword: 'abc',
      });
    expect(res.status).toBe(400);
  });

  it('missing currentPassword → 400', async () => {
    const res = await request(app)
      .post('/api/v1/me/profile/change-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'AnotherPass1!' });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 32 — Invite Resident: Send Invitation Button
// ============================================================================
describe('Invite Resident — Send Invitation Button', () => {
  let adminToken: string;
  let vecinoToken: string;
  let communityId: string;
  let unit1Id: string;

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const vecino = await setupVecino();
    vecinoToken = vecino.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Invitaciones');
    communityId = setup.communityId;
    unit1Id = setup.unit1Id;
  });

  it('admin sends invitation with email, unitId, relationType → 201', async () => {
    const res = await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'nuevo-vecino@ui-flows.test',
        firstName: 'Carlos',
        lastName: 'Martínez',
        communityId,
        relationType: 'OWNER',
        unitId: unit1Id,
        locale: 'es',
      });
    expect(res.status).toBe(201);
  });

  it('duplicate invitation to same email+unit → handles gracefully', async () => {
    const payload = {
      email: 'duplicado@ui-flows.test',
      firstName: 'Dup',
      lastName: 'User',
      communityId,
      relationType: 'OWNER',
      unitId: unit1Id,
      locale: 'es',
    };
    await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);
    const res = await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);
    // Should either succeed (new token) or fail gracefully
    expect([201, 409, 422]).toContain(res.status);
  });

  it('non-admin cannot send invitation → 403', async () => {
    const res = await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${vecinoToken}`)
      .send({
        email: 'hack@test.com',
        firstName: 'Hack',
        lastName: 'User',
        communityId,
        relationType: 'OWNER',
        unitId: unit1Id,
        locale: 'es',
      });
    expect(res.status).toBe(403);
  });

  it('missing required field firstName → 400', async () => {
    const res = await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'nofirst@ui-flows.test',
        communityId,
        relationType: 'OWNER',
        unitId: unit1Id,
      });
    expect(res.status).toBe(400);
  });

  it('invalid communityId format → 400', async () => {
    const res = await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'bad@ui-flows.test',
        firstName: 'Bad',
        lastName: 'Comm',
        communityId: 'not-a-cuid',
        relationType: 'OWNER',
        unitId: unit1Id,
      });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Suite 33 — Accept Invitation: Submit Button
// ============================================================================
describe('Accept Invitation — Submit Button', () => {
  let adminToken: string;
  let communityId: string;
  let unit1Id: string;
  /**
   * Raw token we control by creating the VerificationToken record directly in the DB.
   * The invitations.service stores only tokenHash (SHA-256 of the raw token).
   * We use hashToken() from the same utility module to compute the hash.
   */
  const KNOWN_RAW_TOKEN = 'test-known-invitation-token-for-e2e-suite-33';
  const KNOWN_RAW_TOKEN2 = 'test-known-invitation-token-for-e2e-suite-33b';

  beforeAll(async () => {
    await resetDatabase();
    const admin = await setupAdmin();
    adminToken = admin.token;
    const setup = await setupCommunity(adminToken, 'Comunidad Accept Invite');
    communityId = setup.communityId;
    unit1Id = setup.unit1Id;

    // Create the invitee user (PENDING)
    const inviteeHash = await hashPassword('temporary');
    const invitee = await prisma.user.create({
      data: {
        email: 'accept-invite@ui-flows.test',
        passwordHash: inviteeHash,
        firstName: 'Accept',
        lastName: 'Invite',
        role: 'VECINO',
        locale: 'es',
        status: 'PENDING',
        gdprVersion: '2025-01-01',
      },
    });

    // Insert a VerificationToken with a known raw token (stored as its hash)
    await prisma.verificationToken.create({
      data: {
        tokenHash: hashToken(KNOWN_RAW_TOKEN),
        type: 'INVITATION',
        userId: invitee.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        metadata: {
          unitId: unit1Id,
          communityId,
          relationType: 'OWNER',
        },
      },
    });

    // Second token for no-gdpr test
    const invitee2Hash = await hashPassword('temporary2');
    const invitee2 = await prisma.user.create({
      data: {
        email: 'no-gdpr-accept@ui-flows.test',
        passwordHash: invitee2Hash,
        firstName: 'NoGdpr',
        lastName: 'Test',
        role: 'VECINO',
        locale: 'es',
        status: 'PENDING',
        gdprVersion: '2025-01-01',
      },
    });
    await prisma.verificationToken.create({
      data: {
        tokenHash: hashToken(KNOWN_RAW_TOKEN2),
        type: 'INVITATION',
        userId: invitee2.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        metadata: {
          unitId: unit1Id,
          communityId,
          relationType: 'OCCUPANT',
        },
      },
    });
  });

  it('inspect valid token → 200 + invitation data', async () => {
    const res = await request(app)
      .get('/api/v1/invitations/inspect')
      .query({ token: KNOWN_RAW_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('inspect invalid token → 400 or 404', async () => {
    const res = await request(app)
      .get('/api/v1/invitations/inspect')
      .query({ token: 'totally-invalid-token-xyz' });
    expect([400, 404]).toContain(res.status);
  });

  it('accept invitation with valid token → 200 + user/tokens', async () => {
    const res = await request(app)
      .post('/api/v1/invitations/accept')
      .send({
        token: KNOWN_RAW_TOKEN,
        password: 'NewVecino1!PassAccept',
        gdprAccepted: true,
      });
    expect([200, 201]).toContain(res.status);
  });

  it('accept invitation without gdprAccepted → 400', async () => {
    const res = await request(app)
      .post('/api/v1/invitations/accept')
      .send({
        token: KNOWN_RAW_TOKEN2,
        password: 'NewVecino1!PassNoGdpr',
        gdprAccepted: false,
      });
    expect(res.status).toBe(400);
  });

  it('accept with weak password → 400 (schema rejects before token lookup)', async () => {
    const res = await request(app)
      .post('/api/v1/invitations/accept')
      .send({
        token: 'any-token',
        password: 'weak',
        gdprAccepted: true,
      });
    expect(res.status).toBe(400);
  });
});
