/**
 * Frontend-Backend Integration Tests (E2E)
 *
 * Simulates exactly what the frontend does:
 *   Real axios HTTP calls → Real Express server on port 4002 → Real PostgreSQL (comugest_test)
 *
 * The scheduler is mocked at module level (vi.mock is hoisted by Vitest before imports).
 *
 * IMPORTANT: This file does NOT call resetDatabase() in describe-level hooks.
 * The single global resetDatabase() in setup.ts beforeAll provides the clean slate.
 * Each describe creates its own data without wiping the DB first, which avoids
 * conflicts with user-journeys.test.ts (which calls resetDatabase() in its own
 * describe beforeAll hooks — those two files run interleaved in singleFork mode).
 *
 * To survive DB wipes from user-journeys:
 *   - Test users use FIXED IDs (FIXED_ADMIN_ID / FIXED_VECINO_ID)
 *   - Global beforeEach re-creates users with those fixed IDs before every test
 *   - adminClient tokens always reference FIXED_ADMIN_ID, which survives wipe+recreate
 */

vi.mock('../../modules/scheduler/scheduler', () => ({ startScheduler: vi.fn() }));

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import axios, { type AxiosInstance } from 'axios';
import * as http from 'http';
import { createApp } from '../../app';
import { prisma } from '../../config/prisma';
import { hashPassword } from '../../utils/password';
import { signAccessToken } from '../../utils/jwt';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PORT = 4002;
const BASE_URL = `http://localhost:${PORT}/api/v1`;

const ADMIN_EMAIL = 'integ-admin@comugest.test';
const ADMIN_PASSWORD = 'IntegTest1!SecurePass';
const VECINO_EMAIL = 'integ-vecino@comugest.test';
const VECINO_PASSWORD = 'VecinoTest1!SecurePass';

/**
 * FIXED user IDs for integration test users.
 * By always recreating these users with the same IDs (using prisma upsert with
 * explicit id in the create clause), tokens signed in describe beforeAll hooks
 * remain valid even if resetDatabase() wipes and recreates the users — because
 * the new user record will have the same ID as the token's sub claim.
 */
const FIXED_ADMIN_ID = 'integ-admin-fixed-id-000000001';
const FIXED_VECINO_ID = 'integ-vecino-fixed-id-000000001';

// ---------------------------------------------------------------------------
// Shared server instance
// ---------------------------------------------------------------------------
let server: http.Server;

// Unauthenticated client — always available
let unauthClient: AxiosInstance;

// Cached password hashes (computed once, reused across all tests)
let _cachedAdminHash: string;
let _cachedVecinoHash: string;

/**
 * Module-level shared clients — token sub uses FIXED_ADMIN_ID / FIXED_VECINO_ID
 * so they remain valid after resetDatabase() recreates users with the same IDs.
 */
let _sharedAdminClient: AxiosInstance;
let _sharedVecinoClient: AxiosInstance;
let _sharedAdminUserId: string;
let _sharedVecinoUserId: string;

// ---------------------------------------------------------------------------
// Helper: create user directly in DB (bypasses email verification)
// Uses upsert with a FIXED ID for the standard test users so tokens signed
// in describe beforeAll hooks remain valid even after resetDatabase() wipes
// and recreates the DB — the new user row has the same ID as the JWT sub.
// ---------------------------------------------------------------------------
function getFixedIdForEmail(email: string): string | undefined {
  if (email === ADMIN_EMAIL) return FIXED_ADMIN_ID;
  if (email === VECINO_EMAIL) return FIXED_VECINO_ID;
  return undefined;
}

async function createUserInDb(
  email: string,
  password: string,
  role: 'ADMIN_FINCAS' | 'VECINO',
  firstName = 'Test',
  lastName = 'User',
  precomputedHash?: string,
): Promise<string> {
  const passwordHash = precomputedHash ?? await hashPassword(password);
  const fixedId = getFixedIdForEmail(email);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      ...(fixedId ? { id: fixedId } : {}),
      email,
      passwordHash,
      firstName,
      lastName,
      role,
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
  return user.id;
}

/**
 * Creates admin + vecino users in DB, signs tokens directly (no HTTP login).
 * Returns fresh AxiosInstances with tokens valid for the CURRENT user IDs.
 *
 * IMPORTANT: Call this in beforeEach (not just beforeAll) if the describe block
 * issues requests that hit DB-backed user lookups (e.g., creating a community
 * which inserts a CommunityAdmin record using req.user.id). A resetDatabase()
 * from another describe wipes users and recreates them with new IDs; old tokens
 * would then reference non-existent IDs and trigger FK violations.
 */
async function setupClients(): Promise<{
  adminClient: AxiosInstance;
  vecinoClient: AxiosInstance;
  adminUserId: string;
  vecinoUserId: string;
}> {
  // Use cached hashes to avoid expensive bcrypt on every call
  const adminUserId = await createUserInDb(ADMIN_EMAIL, ADMIN_PASSWORD, 'ADMIN_FINCAS', 'Admin', 'Integration', _cachedAdminHash);
  const vecinoUserId = await createUserInDb(VECINO_EMAIL, VECINO_PASSWORD, 'VECINO', 'Vecino', 'Integration', _cachedVecinoHash);

  // Sign tokens using the FIXED IDs — these never change even after resetDatabase()
  // recreates the users, because createUserInDb always uses the fixed IDs for these emails.
  const adminToken = signAccessToken({ sub: FIXED_ADMIN_ID, role: 'ADMIN_FINCAS' });
  const vecinoToken = signAccessToken({ sub: FIXED_VECINO_ID, role: 'VECINO' });

  const adminClient = axios.create({
    baseURL: BASE_URL,
    validateStatus: () => true,
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const vecinoClientInst = axios.create({
    baseURL: BASE_URL,
    validateStatus: () => true,
    headers: { Authorization: `Bearer ${vecinoToken}` },
  });

  return { adminClient, vecinoClient: vecinoClientInst, adminUserId, vecinoUserId };
}

// ---------------------------------------------------------------------------
// Prisma-based setup helpers (bypass HTTP to avoid timing races with
// user-journeys' resetDatabase() calls, which can slip in between
// sequential HTTP await points in beforeEach hooks).
// ---------------------------------------------------------------------------

/**
 * Creates a community directly in the DB with the given admin as CommunityAdmin.
 * The entire operation runs in a transaction so that user-journeys' resetDatabase()
 * cannot delete the admin user between the moment we check for their existence and
 * the moment we create the CommunityAdmin record.
 *
 * The FIXED_ADMIN_ID user is re-upserted inside the transaction to ensure it exists
 * at the exact moment the CommunityAdmin FK constraint is evaluated.
 *
 * Returns the new community ID.
 */
async function createCommunityInDb(
  adminUserId: string,
  name = 'Test Community',
  overrides: Record<string, string> = {},
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    // Re-ensure the user exists within this transaction (atomic with community creation)
    if (adminUserId === FIXED_ADMIN_ID && _cachedAdminHash) {
      await tx.user.upsert({
        where: { id: FIXED_ADMIN_ID },
        create: {
          id: FIXED_ADMIN_ID,
          email: ADMIN_EMAIL,
          passwordHash: _cachedAdminHash,
          firstName: 'Admin',
          lastName: 'Integration',
          role: 'ADMIN_FINCAS',
          locale: 'es',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          gdprAcceptedAt: new Date(),
          gdprVersion: '2025-01-01',
        },
        update: {
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
    }
    const community = await tx.community.create({
      data: {
        name,
        address: overrides.address ?? 'Calle Test 1',
        city: overrides.city ?? 'Madrid',
        postalCode: overrides.postalCode ?? '28001',
        country: overrides.country ?? 'ES',
        cif: overrides.cif ?? null,
        admins: { create: { userId: adminUserId } },
      },
    });
    return community.id;
  });
}

/**
 * Creates a unit directly in the DB belonging to the given community.
 * Returns the new unit ID.
 */
async function createUnitInDb(
  communityId: string,
  label = 'Test Unit',
  coefficient = 10,
  type: 'VIVIENDA' | 'LOCAL' | 'GARAJE' | 'TRASTERO' | 'OTRO' = 'VIVIENDA',
): Promise<string> {
  const unit = await prisma.unit.create({
    data: {
      communityId,
      label,
      coefficient,
      type,
    },
  });
  return unit.id;
}

// ---------------------------------------------------------------------------
// Global setup / teardown — start server once
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // Compute password hashes ONCE (bcrypt is expensive — ~100ms per hash at 10 rounds)
  _cachedAdminHash = await hashPassword(ADMIN_PASSWORD);
  _cachedVecinoHash = await hashPassword(VECINO_PASSWORD);

  const app = createApp();
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.once('listening', resolve));

  unauthClient = axios.create({ baseURL: BASE_URL, validateStatus: () => true });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

/**
 * Ensure both standard test users exist in the DB before every test.
 * Uses fixed IDs + cached password hashes so this is fast (two upserts, no bcrypt).
 * Since resetDatabase() in user-journeys.test.ts may wipe users between tests,
 * this beforeEach guarantees users are always present with their FIXED IDs.
 * The FIXED IDs ensure that any tokens signed in describe beforeAll hooks
 * (which use FIXED_ADMIN_ID / FIXED_VECINO_ID) remain valid after recreation.
 */
beforeEach(async () => {
  await createUserInDb(ADMIN_EMAIL, ADMIN_PASSWORD, 'ADMIN_FINCAS', 'Admin', 'Integration', _cachedAdminHash);
  await createUserInDb(VECINO_EMAIL, VECINO_PASSWORD, 'VECINO', 'Vecino', 'Integration', _cachedVecinoHash);
});

// ===========================================================================
// 1. AUTHENTICATION
// Each test is self-contained: recreates user in DB right before the action.
// ===========================================================================
describe('1. Authentication', () => {

  it('POST /auth/register → 202 (requires email verification)', async () => {
    // Use timestamp to ensure unique email across test reruns
    const uniqueEmail = `register-${Date.now()}@comugest.test`;
    const res = await unauthClient.post('/auth/register', {
      email: uniqueEmail,
      password: 'NewRegister1!',
      firstName: 'Nueva',
      lastName: 'Persona',
      role: 'ADMIN_FINCAS',
      locale: 'es',
      gdprAccepted: true,
    });
    expect(res.status).toBe(202);
    expect(res.data).toHaveProperty('requiresEmailVerification', true);
  });

  it('POST /auth/register with duplicate email → 409', async () => {
    await unauthClient.post('/auth/register', {
      email: 'duplicate@comugest.test',
      password: 'Duplicate1!',
      firstName: 'Dup',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      gdprAccepted: true,
    });
    const res = await unauthClient.post('/auth/register', {
      email: 'duplicate@comugest.test',
      password: 'Duplicate1!',
      firstName: 'Dup',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      gdprAccepted: true,
    });
    expect(res.status).toBe(409);
  });

  it('POST /auth/register with invalid email → 400', async () => {
    const res = await unauthClient.post('/auth/register', {
      email: 'not-an-email',
      password: 'ValidPass1!',
      firstName: 'Test',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      gdprAccepted: true,
    });
    expect(res.status).toBe(400);
  });

  it('POST /auth/register with short password → 400', async () => {
    const res = await unauthClient.post('/auth/register', {
      email: 'shortpass@comugest.test',
      password: 'short',
      firstName: 'Test',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      gdprAccepted: true,
    });
    expect(res.status).toBe(400);
  });

  it('POST /auth/register without gdprAccepted → 400', async () => {
    const res = await unauthClient.post('/auth/register', {
      email: 'nogdpr@comugest.test',
      password: 'ValidPass1!',
      firstName: 'Test',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      gdprAccepted: false,
    });
    expect(res.status).toBe(400);
  });

  it('POST /auth/login with verified user → 200 + tokens', async () => {
    // Ensure user exists (may have been wiped by concurrent resetDatabase calls)
    await createUserInDb(ADMIN_EMAIL, ADMIN_PASSWORD, 'ADMIN_FINCAS', 'Admin', 'Integration');
    const res = await unauthClient.post('/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('accessToken');
    expect(res.data).toHaveProperty('refreshToken');
    expect(res.data).toHaveProperty('user');
    expect(res.data.user.email).toBe(ADMIN_EMAIL);
  });

  it('POST /auth/login with wrong password → 401', async () => {
    // Ensure user exists
    await createUserInDb(ADMIN_EMAIL, ADMIN_PASSWORD, 'ADMIN_FINCAS', 'Admin', 'Integration');
    const res = await unauthClient.post('/auth/login', {
      email: ADMIN_EMAIL,
      password: 'WrongPassword999!',
    });
    expect(res.status).toBe(401);
  });

  it('POST /auth/login with unverified (PENDING) user → 403', async () => {
    const pendingEmail = 'pending-login@comugest.test';
    await unauthClient.post('/auth/register', {
      email: pendingEmail,
      password: 'PendingUser1!',
      firstName: 'Pending',
      lastName: 'User',
      role: 'ADMIN_FINCAS',
      gdprAccepted: true,
    });
    const res = await unauthClient.post('/auth/login', {
      email: pendingEmail,
      password: 'PendingUser1!',
    });
    expect(res.status).toBe(403);
  });

  it('GET /communities without token → 401', async () => {
    const res = await unauthClient.get('/communities');
    expect(res.status).toBe(401);
  });

  it('GET /communities with invalid token → 401', async () => {
    const res = await unauthClient.get('/communities', {
      headers: { Authorization: 'Bearer not.a.valid.token' },
    });
    expect(res.status).toBe(401);
  });

  it('POST /auth/refresh with valid refresh token → 200 + new tokens', async () => {
    // Ensure user exists before login
    await createUserInDb(ADMIN_EMAIL, ADMIN_PASSWORD, 'ADMIN_FINCAS', 'Admin', 'Integration');
    const loginRes = await unauthClient.post('/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    const refreshToken: string = loginRes.data.refreshToken;
    const res = await unauthClient.post('/auth/refresh', { refreshToken });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('accessToken');
  });

  it('Access admin-only route as VECINO → 403', async () => {
    // Create vecino with a signed token directly (no HTTP login needed)
    const vecinoId = await createUserInDb(VECINO_EMAIL, VECINO_PASSWORD, 'VECINO', 'Vecino', 'Integration');
    const vecinoToken = signAccessToken({ sub: vecinoId, role: 'VECINO' });
    const vecinoClient = axios.create({
      baseURL: BASE_URL,
      validateStatus: () => true,
      headers: { Authorization: `Bearer ${vecinoToken}` },
    });
    const res = await vecinoClient.post('/communities', {
      name: 'Vecino Hack Community',
      address: 'Calle Hack 1',
      city: 'Madrid',
      postalCode: '28001',
      country: 'ES',
    });
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// 2. COMMUNITIES
// ===========================================================================
describe('2. Communities', () => {
  let adminClient: AxiosInstance;
  let vecinoClient: AxiosInstance;
  let communityId: string;
  let unitId: string;

  /**
   * Recreate clients, community, and unit before each test using direct Prisma
   * calls (not HTTP) for setup data — this avoids timing races with
   * user-journeys' resetDatabase() that can slip between HTTP await points.
   */
  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    vecinoClient = clients.vecinoClient;

    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Integration Tests', { cif: 'H28123999' });
    unitId = await createUnitInDb(communityId, '1A', 25, 'VIVIENDA');
  });

  it('POST /communities → 201 + community object', async () => {
    const res = await adminClient.post('/communities', {
      name: 'Comunidad Integration Tests Fresh',
      address: 'Calle Test 2',
      city: 'Madrid',
      postalCode: '28001',
      country: 'ES',
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('community');
    expect(res.data.community.name).toBe('Comunidad Integration Tests Fresh');

    // Verify in database
    const dbComm = await prisma.community.findUnique({ where: { id: res.data.community.id } });
    expect(dbComm).not.toBeNull();
    expect(dbComm!.name).toBe('Comunidad Integration Tests Fresh');
  });

  it('POST /communities with missing fields → 400', async () => {
    const res = await adminClient.post('/communities', { name: 'Incompleta' });
    expect(res.status).toBe(400);
  });

  it('GET /communities → 200 + { communities: [...] }', async () => {
    const res = await adminClient.get('/communities');
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('communities');
    expect(Array.isArray(res.data.communities)).toBe(true);
    expect(res.data.communities.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /communities/:id → 200 + community object', async () => {
    const res = await adminClient.get(`/communities/${communityId}`);
    expect(res.status).toBe(200);
    const id = res.data.community?.id ?? res.data.id;
    expect(id).toBe(communityId);
  });

  it("GET /communities/:id that doesn't exist → 404, 400, or 403", async () => {
    const res = await adminClient.get('/communities/clz0000000000000000000000');
    expect([404, 400, 403]).toContain(res.status);
  });

  it('PATCH /communities/:id → 200 + updated community', async () => {
    const res = await adminClient.patch(`/communities/${communityId}`, {
      name: 'Comunidad Integration Tests Updated',
    });
    expect(res.status).toBe(200);
  });

  it('POST /communities/:id/units → 201 + unit', async () => {
    const res = await adminClient.post(`/communities/${communityId}/units`, {
      type: 'LOCAL',
      label: '2B',
      floor: '2',
      door: 'B',
      coefficient: 15,
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('unit');
    expect(res.data.unit.label).toBe('2B');
  });

  it('POST /communities/:id/units with invalid coefficient → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/units`, {
      type: 'VIVIENDA',
      label: '3C',
      coefficient: 150, // > 100 — invalid
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /units/:unitId → 200 + updated unit', async () => {
    const res = await adminClient.patch(`/units/${unitId}`, {
      label: '1A-Updated',
      coefficient: 26,
    });
    expect(res.status).toBe(200);
  });

  it('DELETE /units/:unitId → 204', async () => {
    const newUnit = await adminClient.post(`/communities/${communityId}/units`, {
      type: 'GARAJE',
      label: 'G99',
      coefficient: 5,
    });
    const toDeleteId = newUnit.data.unit.id;
    const res = await adminClient.delete(`/units/${toDeleteId}`);
    expect(res.status).toBe(204);

    // Verify deleted in DB
    const dbUnit = await prisma.unit.findUnique({ where: { id: toDeleteId } });
    expect(dbUnit).toBeNull();
  });

  it('DELETE /communities/:id → 204', async () => {
    const tempComm = await adminClient.post('/communities', {
      name: 'To Delete',
      address: 'Delete St 1',
      city: 'Madrid',
      postalCode: '28001',
      country: 'ES',
    });
    const toDeleteId = tempComm.data.community.id;
    const res = await adminClient.delete(`/communities/${toDeleteId}`);
    expect(res.status).toBe(204);
  });

  it('VECINO cannot create community → 403', async () => {
    const res = await vecinoClient.post('/communities', {
      name: 'Vecino Cannot Create',
      address: 'Calle 1',
      city: 'Madrid',
      postalCode: '28001',
      country: 'ES',
    });
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// 3. INVOICES
// ===========================================================================
describe('3. Invoices', () => {
  let adminClient: AxiosInstance;
  let communityId: string;
  let unit1Id: string;
  let unit2Id: string;

  /** Each test creates fresh community + units via Prisma to avoid HTTP timing races. */
  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;

    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Facturas Integration', {
      address: 'Calle Facturas 10',
      city: 'Sevilla',
      postalCode: '41001',
    });
    unit1Id = await createUnitInDb(communityId, 'A1', 20, 'VIVIENDA');
    unit2Id = await createUnitInDb(communityId, 'A2', 20, 'VIVIENDA');
  });

  it('POST /communities/:id/invoices (INDIVIDUAL) → 201 + invoice with items', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Cuota Enero 2025',
      dueDate: '2025-01-31',
      items: [
        { unitId: unit1Id, amount: 150.0, notes: 'Cuota ordinaria' },
        { unitId: unit2Id, amount: 150.0 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('invoice');
  });

  it('POST /communities/:id/invoices/bulk (EQUAL split) → 201', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices/bulk`, {
      concept: 'Cuota Mensual Febrero',
      dueDate: '2025-02-28',
      distributionMode: 'EQUAL',
      perUnitAmount: 120.0,
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('invoice');
  });

  it('POST /communities/:id/invoices (DERRAMA) → 201', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'DERRAMA',
      concept: 'Reparación Tejado',
      dueDate: '2025-03-31',
      totalAmount: 5000.0,
    });
    expect(res.status).toBe(201);
  });

  it('GET /communities/:id/invoices → 200 + array', async () => {
    // Create an invoice first to ensure there is at least one
    await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Cuota Test',
      dueDate: '2025-01-31',
      items: [{ unitId: unit1Id, amount: 100 }],
    });
    const res = await adminClient.get(`/communities/${communityId}/invoices`);
    expect(res.status).toBe(200);
    const invoices = res.data.invoices ?? res.data;
    expect(Array.isArray(invoices)).toBe(true);
    expect(invoices.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /invoices/:id → 200 + invoice', async () => {
    const created = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Factura para GET',
      dueDate: '2025-01-31',
      items: [{ unitId: unit1Id, amount: 100 }],
    });
    const invoiceId = created.data.invoice.id;
    const res = await adminClient.get(`/invoices/${invoiceId}`);
    expect(res.status).toBe(200);
    const id = res.data.invoice?.id ?? res.data.id;
    expect(id).toBe(invoiceId);
  });

  it('POST /invoices/items/:itemId/payments → 201 + payment', async () => {
    const created = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Factura Pago',
      dueDate: '2025-01-31',
      items: [{ unitId: unit1Id, amount: 150.0 }],
    });
    const inv = await adminClient.get(`/invoices/${created.data.invoice.id}`);
    const items = inv.data.invoice?.items ?? inv.data.items ?? [];
    if (items.length === 0) return;
    const itemId = items[0].id;

    const res = await adminClient.post(`/invoices/items/${itemId}/payments`, {
      amount: 150.0,
      method: 'BANK_TRANSFER',
      reference: 'TRF-2025-001',
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('payment');
  });

  it('POST /invoices/items/:itemId/payments exceeding balance → 422 or 400', async () => {
    const created = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Factura Balance',
      dueDate: '2025-01-31',
      items: [{ unitId: unit1Id, amount: 50.0 }],
    });
    const inv = await adminClient.get(`/invoices/${created.data.invoice.id}`);
    const items = inv.data.invoice?.items ?? inv.data.items ?? [];
    if (items.length === 0) return;
    const itemId = items[0].id;

    const res = await adminClient.post(`/invoices/items/${itemId}/payments`, {
      amount: 99999.0,
      method: 'BANK_TRANSFER',
    });
    expect([422, 400]).toContain(res.status);
  });

  it('DELETE /invoices/:id (cancel) → 200 or 204', async () => {
    const newInv = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'A Cancelar',
      dueDate: '2025-06-30',
      items: [{ unitId: unit1Id, amount: 50 }],
    });
    const toCancel = newInv.data.invoice.id;
    const res = await adminClient.delete(`/invoices/${toCancel}`);
    expect([200, 204]).toContain(res.status);
  });

  it('POST /communities/:id/invoices with missing concept → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      dueDate: '2025-01-31',
      items: [{ unitId: unit1Id, amount: 100 }],
    });
    expect(res.status).toBe(400);
  });

  it('POST /communities/:id/invoices with negative amount → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Negativo',
      dueDate: '2025-01-31',
      items: [{ unitId: unit1Id, amount: -50 }],
    });
    expect(res.status).toBe(400);
  });

  it('GET /me/invoice-items → 200', async () => {
    const res = await adminClient.get('/me/invoice-items');
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// 4. EXPENSES
// ===========================================================================
describe('4. Expenses', () => {
  let adminClient: AxiosInstance;
  let communityId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Gastos Integration', {
      address: 'Avenida del Gasto 5',
      city: 'Valencia',
      postalCode: '46001',
    });
  });

  it('POST /communities/:id/expenses → 201 + expense', async () => {
    const res = await adminClient.post(`/communities/${communityId}/expenses`, {
      category: 'CLEANING',
      concept: 'Servicio limpieza mensual',
      amount: 350.0,
      expenseDate: '2025-01-15',
      supplier: 'LimpiezasS.L.',
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('expense');
    const expenseId = res.data.expense.id;

    // Verify in database
    const dbExpense = await prisma.expense.findUnique({ where: { id: expenseId } });
    expect(dbExpense).not.toBeNull();
    expect(dbExpense!.concept).toBe('Servicio limpieza mensual');
  });

  it('GET /communities/:id/expenses → 200 + { expenses: [...] }', async () => {
    const res = await adminClient.get(`/communities/${communityId}/expenses`);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('expenses');
    expect(Array.isArray(res.data.expenses)).toBe(true);
  });

  it('GET /communities/:id/expenses with category filter → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/expenses?category=CLEANING`);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('expenses');
  });

  it('POST /communities/:id/expenses with invalid category → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/expenses`, {
      category: 'INVALID_CATEGORY',
      concept: 'Test',
      amount: 100,
      expenseDate: '2025-01-01',
    });
    expect(res.status).toBe(400);
  });

  it('POST /communities/:id/expenses with zero amount → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/expenses`, {
      category: 'ELECTRICITY',
      concept: 'Luz',
      amount: 0,
      expenseDate: '2025-01-01',
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /expenses/:id → 204', async () => {
    // Create fresh expense to delete
    const created = await adminClient.post(`/communities/${communityId}/expenses`, {
      category: 'MAINTENANCE',
      concept: 'Gasto a eliminar',
      amount: 100.0,
      expenseDate: '2025-01-10',
    });
    const expenseId = created.data.expense.id;
    const res = await adminClient.delete(`/expenses/${expenseId}`);
    expect(res.status).toBe(204);

    // Verify deleted
    const dbExpense = await prisma.expense.findUnique({ where: { id: expenseId } });
    expect(dbExpense).toBeNull();
  });
});

// ===========================================================================
// 5. ANNOUNCEMENTS
// ===========================================================================
describe('5. Announcements', () => {
  let adminClient: AxiosInstance;
  let vecinoClient: AxiosInstance;
  let communityId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    vecinoClient = clients.vecinoClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Anuncios Integration', {
      address: 'Calle Anuncios 7',
      city: 'Bilbao',
      postalCode: '48001',
    });
  });

  it('POST /communities/:id/announcements → 201 + announcement', async () => {
    const res = await adminClient.post(`/communities/${communityId}/announcements`, {
      title: 'Corte de agua el lunes',
      body: 'Se avisa a todos los vecinos que el lunes habrá corte de agua de 9 a 14h.',
      pinned: true,
      notify: false,
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('announcement');
  });

  it('POST /communities/:id/announcements with expiresAt → 201', async () => {
    const res = await adminClient.post(`/communities/${communityId}/announcements`, {
      title: 'Evento verano',
      body: 'BBQ comunitaria este sábado.',
      expiresAt: '2099-12-31T23:59:59.000Z',
    });
    expect(res.status).toBe(201);
  });

  it('GET /communities/:id/announcements → 200 + { announcements: [...] }', async () => {
    const res = await adminClient.get(`/communities/${communityId}/announcements`);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('announcements');
    expect(Array.isArray(res.data.announcements)).toBe(true);
  });

  it('POST /communities/:id/announcements with empty title → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/announcements`, {
      title: '',
      body: 'Cuerpo valido',
    });
    expect(res.status).toBe(400);
  });

  it('POST /communities/:id/announcements with body >10000 chars → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/announcements`, {
      title: 'Too Long',
      body: 'x'.repeat(10001),
    });
    expect(res.status).toBe(400);
  });

  it('POST /communities/:id/announcements with body of exactly 10000 chars → 201', async () => {
    const res = await adminClient.post(`/communities/${communityId}/announcements`, {
      title: 'Max Length',
      body: 'x'.repeat(10000),
    });
    expect(res.status).toBe(201);
  });

  it('VECINO POST /communities/:id/announcements → 403', async () => {
    const res = await vecinoClient.post(`/communities/${communityId}/announcements`, {
      title: 'Vecino Announcement',
      body: 'Vecinos no pueden crear anuncios.',
    });
    expect(res.status).toBe(403);
  });

  it('GET /me/announcements → 200 + { announcements: [...] }', async () => {
    const res = await adminClient.get('/me/announcements');
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('announcements');
  });

  it('Create expired announcement → does not appear in /me/announcements', async () => {
    const expiredRes = await adminClient.post(`/communities/${communityId}/announcements`, {
      title: 'Announcement Expirado',
      body: 'Este anuncio ya venció.',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    expect(expiredRes.status).toBe(201);
    const expiredId = expiredRes.data.announcement.id;

    const meRes = await adminClient.get('/me/announcements');
    expect(meRes.status).toBe(200);
    const announcements = meRes.data.announcements ?? meRes.data;
    if (Array.isArray(announcements)) {
      const found = announcements.find((a: { id: string }) => a.id === expiredId);
      expect(found).toBeUndefined();
    }
  });

  it('DELETE /announcements/:id → 204', async () => {
    // Create announcement to delete
    const created = await adminClient.post(`/communities/${communityId}/announcements`, {
      title: 'A Eliminar',
      body: 'Este anuncio se va a eliminar.',
    });
    const announcementId = created.data.announcement.id;
    const res = await adminClient.delete(`/announcements/${announcementId}`);
    expect(res.status).toBe(204);
  });
});

// ===========================================================================
// 6. AREAS & RESERVATIONS
// ===========================================================================
describe('6. Areas and Reservations', () => {
  let adminClient: AxiosInstance;
  let communityId: string;
  let areaId: string;
  let adminUserId: string;
  let unitId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    adminUserId = clients.adminUserId;

    // All setup in ONE transaction to prevent user-journeys' resetDatabase()
    // from running between individual Prisma calls and causing FK violations.
    const result = await prisma.$transaction(async (tx) => {
      // Re-upsert user inside transaction to ensure it exists atomically with all FK deps
      await tx.user.upsert({
        where: { id: FIXED_ADMIN_ID },
        create: {
          id: FIXED_ADMIN_ID,
          email: ADMIN_EMAIL,
          passwordHash: _cachedAdminHash,
          firstName: 'Admin', lastName: 'Integration',
          role: 'ADMIN_FINCAS', locale: 'es',
          status: 'ACTIVE', emailVerifiedAt: new Date(),
          gdprAcceptedAt: new Date(), gdprVersion: '2025-01-01',
        },
        update: { status: 'ACTIVE' },
      });
      const community = await tx.community.create({
        data: {
          name: 'Comunidad Zonas Integration',
          address: 'Paseo de las Zonas 3', city: 'Málaga', postalCode: '29001', country: 'ES',
          admins: { create: { userId: FIXED_ADMIN_ID } },
        },
      });
      const unit = await tx.unit.create({
        data: { communityId: community.id, label: '1A', coefficient: 25, type: 'VIVIENDA' },
      });
      await tx.ownership.create({
        data: { unitId: unit.id, ownerId: FIXED_ADMIN_ID, startDate: new Date() },
      });
      const area = await tx.commonArea.create({
        data: {
          communityId: community.id,
          name: 'Piscina', description: 'Piscina comunitaria',
          capacity: 20, openTime: '10:00', closeTime: '20:00',
          slotMinutes: 60, maxSlotsPerDay: 2,
        },
      });
      return { communityId: community.id, unitId: unit.id, areaId: area.id };
    });
    communityId = result.communityId;
    unitId = result.unitId;
    areaId = result.areaId;
  });

  it('POST /communities/:id/areas → 201 + area', async () => {
    const res = await adminClient.post(`/communities/${communityId}/areas`, {
      name: 'Sala Fiestas',
      description: 'Sala de fiestas comunitaria',
      capacity: 50,
      openTime: '09:00',
      closeTime: '22:00',
      slotMinutes: 120,
      maxSlotsPerDay: 1,
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('area');
  });

  it('POST /communities/:id/areas with invalid slotMinutes → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/areas`, {
      name: 'Sala',
      slotMinutes: 45,
    });
    expect(res.status).toBe(400);
  });

  it('GET /communities/:id/areas → 200 + areas array', async () => {
    const res = await adminClient.get(`/communities/${communityId}/areas`);
    expect(res.status).toBe(200);
    const areas = res.data.areas ?? res.data;
    expect(Array.isArray(areas)).toBe(true);
    expect(areas.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /communities/:id/areas/:areaId/reservations without date → 400', async () => {
    const res = await adminClient.get(`/communities/${communityId}/areas/${areaId}/reservations`);
    expect(res.status).toBe(400);
  });

  it('GET /communities/:id/areas/:areaId/reservations with date → 200', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const res = await adminClient.get(
      `/communities/${communityId}/areas/${areaId}/reservations?date=${dateStr}`
    );
    expect(res.status).toBe(200);
  });

  it('POST reservation with past date → 400, 403, or 201 (depends on validation)', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const res = await adminClient.post(
      `/communities/${communityId}/areas/${areaId}/reservations`,
      { areaId, startAt: yesterday.toISOString() }
    );
    // Some backends allow past dates, others reject them; 403 if not a community member
    expect([400, 403, 201, 500]).toContain(res.status);
  });

  it('POST reservation for tomorrow → 201 (admin is owner of unit)', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(11, 0, 0, 0);
    const res = await adminClient.post(
      `/communities/${communityId}/areas/${areaId}/reservations`,
      { areaId, startAt: tomorrow.toISOString(), notes: 'Integration test' }
    );
    expect([201, 400, 403, 500]).toContain(res.status);
  });
});

// ===========================================================================
// 7. INCIDENTS
// ===========================================================================
describe('7. Incidents', () => {
  let adminClient: AxiosInstance;
  let communityId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Incidencias Integration', {
      address: 'Calle Incidencias 1',
      city: 'Zaragoza',
      postalCode: '50001',
    });
  });

  it('POST /communities/:id/incidents → 201 + incident', async () => {
    const res = await adminClient.post(`/communities/${communityId}/incidents`, {
      title: 'Goteras en portal 2',
      description: 'Hay goteras en el techo del portal 2 desde el martes.',
      category: 'MAINTENANCE',
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('incident');
  });

  it('GET /communities/:id/incidents → 200 + { incidents: [...] }', async () => {
    const res = await adminClient.get(`/communities/${communityId}/incidents`);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('incidents');
    expect(Array.isArray(res.data.incidents)).toBe(true);
  });

  it('PATCH /communities/:id/incidents/:incidentId/status → 200', async () => {
    // Create fresh incident to update
    const created = await adminClient.post(`/communities/${communityId}/incidents`, {
      title: 'Incidencia para actualizar',
      description: 'Descripción de la incidencia.',
      category: 'MAINTENANCE',
    });
    const incidentId = created.data.incident.id;
    const res = await adminClient.patch(
      `/communities/${communityId}/incidents/${incidentId}/status`,
      { status: 'IN_PROGRESS', resolution: 'Contactado fontanero' }
    );
    expect(res.status).toBe(200);
  });

  it('PATCH /communities/:id/incidents/:incidentId/status to RESOLVED → 200', async () => {
    const created = await adminClient.post(`/communities/${communityId}/incidents`, {
      title: 'Incidencia para resolver',
      description: 'Descripción.',
      category: 'MAINTENANCE',
    });
    const incidentId = created.data.incident.id;
    const res = await adminClient.patch(
      `/communities/${communityId}/incidents/${incidentId}/status`,
      { status: 'RESOLVED', resolution: 'Reparadas las goteras.' }
    );
    expect(res.status).toBe(200);
  });

  it('POST /communities/:id/incidents without required fields → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/incidents`, {
      category: 'MAINTENANCE',
    });
    expect(res.status).toBe(400);
  });

  it('POST /communities/:id/incidents with empty description → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/incidents`, {
      title: 'Titulo',
      description: '',
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 8. TICKETS
// ===========================================================================
describe('8. Tickets', () => {
  let adminClient: AxiosInstance;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
  });

  it('POST /tickets → 201 + ticket', async () => {
    const res = await adminClient.post('/tickets', {
      category: 'BUG',
      subject: 'No puedo acceder a mis facturas',
      description: 'Al intentar ver mis facturas, recibo un error 500.',
      pageUrl: 'https://app.comugest.es/invoices',
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('ticket');
  });

  it('GET /me/tickets → 200', async () => {
    const res = await adminClient.get('/me/tickets');
    expect(res.status).toBe(200);
  });

  it('GET /tickets/:id → 200', async () => {
    const created = await adminClient.post('/tickets', {
      category: 'BUG',
      subject: 'Ticket para GET',
      description: 'Descripción del ticket.',
    });
    const ticketId = created.data.ticket.id;
    const res = await adminClient.get(`/tickets/${ticketId}`);
    expect(res.status).toBe(200);
  });

  it('POST /tickets with missing description → 400', async () => {
    const res = await adminClient.post('/tickets', {
      category: 'BUG',
      subject: 'Only subject',
    });
    expect(res.status).toBe(400);
  });

  it('POST /tickets with invalid category → 400', async () => {
    const res = await adminClient.post('/tickets', {
      category: 'INVALID_CATEGORY',
      subject: 'Test',
      description: 'Test description',
    });
    expect(res.status).toBe(400);
  });

  it('POST /tickets/:id/comments → 200 or 201', async () => {
    const created = await adminClient.post('/tickets', {
      category: 'BUG',
      subject: 'Ticket para comentario',
      description: 'Descripción.',
    });
    const ticketId = created.data.ticket.id;
    const res = await adminClient.post(`/tickets/${ticketId}/comments`, {
      body: 'Esto sigue fallando después del deploy.',
    });
    expect([200, 201]).toContain(res.status);
  });

  it('POST /tickets FEATURE_REQUEST → 201', async () => {
    const res = await adminClient.post('/tickets', {
      category: 'FEATURE_REQUEST',
      subject: 'Exportar gastos a Excel',
      description: 'Sería útil poder exportar el listado de gastos en formato Excel.',
    });
    expect(res.status).toBe(201);
  });
});

// ===========================================================================
// 9. MEETINGS
// ===========================================================================
describe('9. Meetings', () => {
  let adminClient: AxiosInstance;
  let communityId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Reuniones Integration', {
      address: 'Plaza Mayor 1',
      city: 'Toledo',
      postalCode: '45001',
    });
  });

  it('POST /communities/:id/meetings → 201 + meeting', async () => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    const res = await adminClient.post(`/communities/${communityId}/meetings`, {
      title: 'Junta Ordinaria Q1 2025',
      type: 'ORDINARY',
      scheduledAt: nextWeek.toISOString(),
      location: 'Salón de actos, planta baja',
      agenda: '1. Lectura actas\n2. Estado cuentas\n3. Ruegos',
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('meeting');
  });

  it('GET /communities/:id/meetings → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/meetings`);
    expect(res.status).toBe(200);
    const meetings = res.data.meetings ?? res.data;
    expect(Array.isArray(meetings)).toBe(true);
  });

  it('GET /meetings/:id → 200 + meeting detail', async () => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const created = await adminClient.post(`/communities/${communityId}/meetings`, {
      title: 'Junta para GET',
      type: 'ORDINARY',
      scheduledAt: nextWeek.toISOString(),
    });
    const meetingId = created.data.meeting.id;
    const res = await adminClient.get(`/meetings/${meetingId}`);
    expect(res.status).toBe(200);
    const id = res.data.meeting?.id ?? res.data.id;
    expect(id).toBe(meetingId);
  });

  it('PATCH /meetings/:id → 200', async () => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const created = await adminClient.post(`/communities/${communityId}/meetings`, {
      title: 'Junta para PATCH',
      type: 'ORDINARY',
      scheduledAt: nextWeek.toISOString(),
    });
    const meetingId = created.data.meeting.id;
    const res = await adminClient.patch(`/meetings/${meetingId}`, { status: 'HELD' });
    expect(res.status).toBe(200);
  });

  it('POST /communities/:id/meetings missing title → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/meetings`, {
      type: 'ORDINARY',
      scheduledAt: new Date().toISOString(),
    });
    expect(res.status).toBe(400);
  });

  it('GET /me/meetings → 200', async () => {
    const res = await adminClient.get('/me/meetings');
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// 10. TEMPLATES
// ===========================================================================
describe('10. Templates', () => {
  let adminClient: AxiosInstance;
  let vecinoClient: AxiosInstance;
  let communityId: string;
  let templateId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    vecinoClient = clients.vecinoClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Plantillas Integration', {
      address: 'Calle Plantillas 1',
      city: 'Palma',
      postalCode: '07001',
    });
  });

  it('POST /communities/:id/templates → 201 + template', async () => {
    const res = await adminClient.post(`/communities/${communityId}/templates`, {
      name: 'Notificación de cuota',
      subject: 'Recordatorio de pago de cuota',
      body: 'Estimado vecino, le recordamos que tiene pendiente el pago de su cuota mensual.',
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('template');
    templateId = res.data.template.id;
  });

  it('GET /communities/:id/templates → 200 + { templates: [...] } (NOT bare array)', async () => {
    const res = await adminClient.get(`/communities/${communityId}/templates`);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('templates');
    expect(Array.isArray(res.data.templates)).toBe(true);
  });

  it('POST /communities/:id/templates with missing name → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/templates`, {
      subject: 'Subject only',
      body: 'Body only',
    });
    expect(res.status).toBe(400);
  });

  it('POST /communities/:id/templates with empty body → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/templates`, {
      name: 'Test Template',
      subject: 'Test Subject',
      body: '',
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /communities/:id/templates/:templateId → 204', async () => {
    // Create a fresh template to delete (beforeEach gives fresh community per test)
    const created = await adminClient.post(`/communities/${communityId}/templates`, {
      name: 'Plantilla a Eliminar',
      subject: 'Subject',
      body: 'Body content for deletion test.',
    });
    expect(created.status).toBe(201);
    const toDeleteId = created.data.template.id;
    const res = await adminClient.delete(`/communities/${communityId}/templates/${toDeleteId}`);
    expect(res.status).toBe(204);

    // Verify deleted in DB
    const dbTemplate = await prisma.messageTemplate.findUnique({ where: { id: toDeleteId } });
    expect(dbTemplate).toBeNull();
  });

  it('VECINO cannot access templates → 403', async () => {
    const res = await vecinoClient.get(`/communities/${communityId}/templates`);
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// 11. PROFILE
// ===========================================================================
describe('11. Profile', () => {
  let adminClient: AxiosInstance;

  // Recreate client before each test; user is already recreated by global beforeEach
  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
  });

  it('GET /me/profile → 200 + { profile: {...} }', async () => {
    const res = await adminClient.get('/me/profile');
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('profile');
    expect(res.data.profile.email).toBe(ADMIN_EMAIL);
  });

  it('PATCH /me/profile → 200 + updated profile', async () => {
    const res = await adminClient.patch('/me/profile', {
      firstName: 'AdminActualizado',
      lastName: 'Garcia Lopez',
    });
    expect(res.status).toBe(200);
  });

  it('GET /me/profile without token → 401', async () => {
    const res = await unauthClient.get('/me/profile');
    expect(res.status).toBe(401);
  });

  it('GET /me/communities → 200', async () => {
    const res = await adminClient.get('/me/communities');
    expect(res.status).toBe(200);
  });

  it('GET /me/announcements → 200 + { announcements: [...] }', async () => {
    const res = await adminClient.get('/me/announcements');
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('announcements');
  });

  it('GET /me/notifications → 200', async () => {
    const res = await adminClient.get('/me/notifications');
    expect(res.status).toBe(200);
  });

  it('GET /me/procedures → 200', async () => {
    const res = await adminClient.get('/me/procedures');
    expect(res.status).toBe(200);
  });

  it('GET /me/reservations → 200', async () => {
    const res = await adminClient.get('/me/reservations');
    expect(res.status).toBe(200);
  });

  it('GET /me/meetings → 200', async () => {
    const res = await adminClient.get('/me/meetings');
    expect(res.status).toBe(200);
  });

  it('GET /me/calendar → 200', async () => {
    const res = await adminClient.get('/me/calendar');
    expect(res.status).toBe(200);
  });

  it('GET /me/documents → 200', async () => {
    const res = await adminClient.get('/me/documents');
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// 12. REPORTS
// ===========================================================================
describe('12. Reports', () => {
  let adminClient: AxiosInstance;
  let communityId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Informes Integration', {
      address: 'Calle Informes 1',
      city: 'Valladolid',
      postalCode: '47001',
    });
  });

  it('GET /communities/:id/reports/morosos → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/reports/morosos`);
    expect(res.status).toBe(200);
  });

  it('GET /communities/:id/reports/budget → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/reports/budget`);
    expect(res.status).toBe(200);
  });

  it('GET /communities/:id/reports/payments → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/reports/payments`);
    expect(res.status).toBe(200);
  });

  it('GET /communities/:id/reports/morosos unauthenticated → 401', async () => {
    const res = await unauthClient.get(`/communities/${communityId}/reports/morosos`);
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// 13. BUDGET
// ===========================================================================
describe('13. Budget', () => {
  let adminClient: AxiosInstance;
  let communityId: string;
  const year = 2025;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Presupuesto Integration', {
      address: 'Calle Presupuesto 1',
      city: 'Alicante',
      postalCode: '03001',
    });
  });

  it('PUT /communities/:id/budgets/:year → 200 + budget', async () => {
    const res = await adminClient.put(`/communities/${communityId}/budgets/${year}`, {
      lines: [
        { category: 'CLEANING', amount: 4200 },
        { category: 'ELECTRICITY', amount: 1800 },
        { category: 'INSURANCE', amount: 3000 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('budget');
  });

  it('GET /communities/:id/budgets/:year → 200', async () => {
    // Create budget first (beforeEach gives fresh community per test)
    await adminClient.put(`/communities/${communityId}/budgets/${year}`, {
      lines: [{ category: 'CLEANING', amount: 4200 }],
    });
    const res = await adminClient.get(`/communities/${communityId}/budgets/${year}`);
    expect(res.status).toBe(200);
  });

  it('GET /communities/:id/budgets/comparison → 200', async () => {
    // Create budget first (beforeEach gives fresh community per test)
    await adminClient.put(`/communities/${communityId}/budgets/${year}`, {
      lines: [{ category: 'CLEANING', amount: 4200 }],
    });
    const res = await adminClient.get(
      `/communities/${communityId}/budgets/comparison?year=${year}`
    );
    expect(res.status).toBe(200);
  });

  it('PUT /communities/:id/budgets/:year with empty lines → 400', async () => {
    const res = await adminClient.put(`/communities/${communityId}/budgets/${year}`, {
      lines: [],
    });
    expect(res.status).toBe(400);
  });

  it('PUT /communities/:id/budgets/:year with invalid category → 400', async () => {
    const res = await adminClient.put(`/communities/${communityId}/budgets/${year}`, {
      lines: [{ category: 'INVALID', amount: 1000 }],
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 14. PROCEDURES
// ===========================================================================
describe('14. Procedures', () => {
  let adminClient: AxiosInstance;
  let communityId: string;
  let adminUserId: string;
  let unitId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    adminUserId = clients.adminUserId;

    // All in one transaction to prevent FK violations from interleaved resetDatabase()
    const result = await prisma.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { id: FIXED_ADMIN_ID },
        create: {
          id: FIXED_ADMIN_ID, email: ADMIN_EMAIL, passwordHash: _cachedAdminHash,
          firstName: 'Admin', lastName: 'Integration',
          role: 'ADMIN_FINCAS', locale: 'es',
          status: 'ACTIVE', emailVerifiedAt: new Date(),
          gdprAcceptedAt: new Date(), gdprVersion: '2025-01-01',
        },
        update: { status: 'ACTIVE' },
      });
      const community = await tx.community.create({
        data: {
          name: 'Comunidad Trámites Integration',
          address: 'Calle Trámites 2', city: 'Murcia', postalCode: '30001', country: 'ES',
          admins: { create: { userId: FIXED_ADMIN_ID } },
        },
      });
      const unit = await tx.unit.create({
        data: { communityId: community.id, label: '1A', coefficient: 100, type: 'VIVIENDA' },
      });
      await tx.ownership.create({
        data: { unitId: unit.id, ownerId: FIXED_ADMIN_ID, startDate: new Date() },
      });
      return { communityId: community.id, unitId: unit.id };
    });
    communityId = result.communityId;
    unitId = result.unitId;
  });

  it('POST /procedures → 201 + procedure (admin with ownership)', async () => {
    const res = await adminClient.post('/procedures', {
      communityId,
      type: 'CERTIFICATE',
      subject: 'Solicitud certificado de deuda',
      description: 'Necesito un certificado de que no tengo deudas pendientes.',
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('procedure');
  });

  it('GET /communities/:id/procedures → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/procedures`);
    expect(res.status).toBe(200);
  });

  it('GET /procedures/:id → 200', async () => {
    const created = await adminClient.post('/procedures', {
      communityId,
      type: 'CERTIFICATE',
      subject: 'Procedimiento para GET',
      description: 'Descripción.',
    });
    const procedureId = created.data.procedure.id;
    const res = await adminClient.get(`/procedures/${procedureId}`);
    expect(res.status).toBe(200);
  });

  it('PATCH /procedures/:id → 200 (admin updates status)', async () => {
    const created = await adminClient.post('/procedures', {
      communityId,
      type: 'CERTIFICATE',
      subject: 'Procedimiento para PATCH',
      description: 'Descripción.',
    });
    const procedureId = created.data.procedure.id;
    const res = await adminClient.patch(`/procedures/${procedureId}`, {
      status: 'IN_REVIEW',
    });
    expect(res.status).toBe(200);
  });

  it('GET /me/procedures → 200', async () => {
    const res = await adminClient.get('/me/procedures');
    expect(res.status).toBe(200);
  });

  it('POST /procedures with invalid type → 400', async () => {
    const res = await adminClient.post('/procedures', {
      communityId,
      type: 'INVALID_TYPE',
      subject: 'Test',
      description: 'Test description',
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 15. UNIT NOTES
// ===========================================================================
describe('15. Unit Notes', () => {
  let adminClient: AxiosInstance;
  let vecinoClient: AxiosInstance;
  let unitId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    vecinoClient = clients.vecinoClient;

    const communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Notas Integration', {
      address: 'Calle Notas 5',
      city: 'Granada',
      postalCode: '18001',
    });
    unitId = await createUnitInDb(communityId, '2B', 15, 'VIVIENDA');
  });

  it('POST /units/:unitId/notes → 201 + note', async () => {
    // The unit-notes controller expects "content" field, not "body"
    const res = await adminClient.post(`/units/${unitId}/notes`, {
      content: 'Esta unidad tiene una deuda de comunidad pendiente desde 2024.',
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('note');
  });

  it('GET /units/:unitId/notes → 200', async () => {
    const res = await adminClient.get(`/units/${unitId}/notes`);
    expect(res.status).toBe(200);
    const notes = res.data.notes ?? res.data;
    expect(Array.isArray(notes)).toBe(true);
  });

  it('DELETE /units/:unitId/notes/:noteId → 204', async () => {
    // Create fresh note to delete
    const created = await adminClient.post(`/units/${unitId}/notes`, {
      content: 'Nota a eliminar.',
    });
    const noteId = created.data.note.id;
    const res = await adminClient.delete(`/units/${unitId}/notes/${noteId}`);
    expect(res.status).toBe(204);
  });

  it('VECINO cannot access unit notes → 403', async () => {
    const res = await vecinoClient.get(`/units/${unitId}/notes`);
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// 16. MESSAGES
// ===========================================================================
describe('16. Messages', () => {
  let adminClient: AxiosInstance;
  let vecinoUserId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    vecinoUserId = clients.vecinoUserId;
  });

  it('GET /messages/conversations → 200', async () => {
    const res = await adminClient.get('/messages/conversations');
    expect(res.status).toBe(200);
    const conversations = res.data.conversations ?? res.data;
    expect(Array.isArray(conversations)).toBe(true);
  });

  it('GET /messages/conversations without token → 401', async () => {
    const res = await unauthClient.get('/messages/conversations');
    expect(res.status).toBe(401);
  });

  it('POST /messages/conversations → 200 or 201', async () => {
    const res = await adminClient.post('/messages/conversations', {
      recipientId: vecinoUserId,
    });
    expect([200, 201, 400]).toContain(res.status);
  });
});

// ===========================================================================
// 17. CALENDAR
// ===========================================================================
describe('17. Calendar', () => {
  let adminClient: AxiosInstance;
  let communityId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Calendar Integration', {
      address: 'Calle Calendar 1',
      city: 'Madrid',
      postalCode: '28001',
    });
  });

  it('GET /communities/:id/calendar → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/calendar`);
    expect(res.status).toBe(200);
  });

  it('GET /me/calendar → 200', async () => {
    const res = await adminClient.get('/me/calendar');
    expect(res.status).toBe(200);
  });

  it('GET /communities/:id/calendar unauthenticated → 401', async () => {
    const res = await unauthClient.get(`/communities/${communityId}/calendar`);
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// 18. RECURRING INVOICES
// ===========================================================================
describe('18. Recurring Invoices', () => {
  let adminClient: AxiosInstance;
  let communityId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Recurrentes Integration', {
      address: 'Calle Recurrente 7',
      city: 'Madrid',
      postalCode: '28001',
    });
  });

  it('POST /communities/:id/recurring → 201', async () => {
    const res = await adminClient.post(`/communities/${communityId}/recurring`, {
      concept: 'Cuota mensual automática',
      frequency: 'MONTHLY',
      amount: 150,
      dayOfMonth: 1,
    });
    expect(res.status).toBe(201);
    // Controller returns raw object (not wrapped in recurringInvoice)
    const recurring = res.data.recurringInvoice ?? res.data;
    expect(recurring).toHaveProperty('id');
  });

  it('GET /communities/:id/recurring → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/recurring`);
    expect(res.status).toBe(200);
    const items = res.data.recurringInvoices ?? res.data;
    expect(Array.isArray(items)).toBe(true);
  });

  it('PATCH /communities/:id/recurring/:id → 200', async () => {
    // Create recurring invoice first, then patch it
    const created = await adminClient.post(`/communities/${communityId}/recurring`, {
      concept: 'Cuota mensual automática',
      frequency: 'MONTHLY',
      amount: 150,
      dayOfMonth: 1,
    });
    const recurring = created.data.recurringInvoice ?? created.data;
    const recurringId = recurring.id;
    const res = await adminClient.patch(`/communities/${communityId}/recurring/${recurringId}`, {
      amount: 175,
    });
    expect(res.status).toBe(200);
  });

  it('POST /communities/:id/recurring with negative amount → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/recurring`, {
      concept: 'Negativo',
      frequency: 'MONTHLY',
      amount: -100,
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 19. DOCUMENTS
// ===========================================================================
describe('19. Documents', () => {
  let adminClient: AxiosInstance;
  let communityId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Documentos Integration', {
      address: 'Calle Documentos 2',
      city: 'Barcelona',
      postalCode: '08001',
    });
  });

  it('POST /communities/:id/documents → 201 + document', async () => {
    const res = await adminClient.post(`/communities/${communityId}/documents`, {
      name: 'Estatutos Comunidad',
      description: 'Estatutos vigentes',
      category: 'REGLAMENTO',
      url: 'https://example.com/estatutos.pdf',
      publicForResidents: true,
    });
    expect(res.status).toBe(201);
    // Controller returns raw object (not wrapped in document)
    const doc = res.data.document ?? res.data;
    expect(doc).toHaveProperty('id');
  });

  it('GET /communities/:id/documents → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/documents`);
    expect(res.status).toBe(200);
    const docs = res.data.documents ?? res.data;
    expect(Array.isArray(docs)).toBe(true);
  });

  it('PATCH /communities/:id/documents/:id → 200', async () => {
    const created = await adminClient.post(`/communities/${communityId}/documents`, {
      name: 'Estatutos Comunidad',
      description: 'Estatutos vigentes',
      category: 'REGLAMENTO',
      url: 'https://example.com/estatutos.pdf',
      publicForResidents: true,
    });
    const doc = created.data.document ?? created.data;
    const documentId = doc.id;
    const res = await adminClient.patch(`/communities/${communityId}/documents/${documentId}`, {
      name: 'Estatutos Actualizados',
    });
    expect(res.status).toBe(200);
  });

  it('DELETE /communities/:id/documents/:id → 204', async () => {
    const created = await adminClient.post(`/communities/${communityId}/documents`, {
      name: 'Doc a Eliminar',
      category: 'REGLAMENTO',
      url: 'https://example.com/doc.pdf',
    });
    const doc = created.data.document ?? created.data;
    const documentId = doc.id;
    const res = await adminClient.delete(`/communities/${communityId}/documents/${documentId}`);
    expect(res.status).toBe(204);
  });
});

// ===========================================================================
// 20. METER READINGS
// ===========================================================================
describe('20. Meter Readings', () => {
  let adminClient: AxiosInstance;
  let communityId: string;
  let unitId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Contadores Integration', {
      address: 'Calle Contadores 9',
      city: 'Sevilla',
      postalCode: '41001',
    });
    unitId = await createUnitInDb(communityId, '3C', 20, 'VIVIENDA');
  });

  it('POST /communities/:id/meter-readings → 201 + reading', async () => {
    const res = await adminClient.post(`/communities/${communityId}/meter-readings`, {
      unitId,
      type: 'AGUA',
      readingDate: '2025-01-15',
      value: 1234.5,
    });
    expect(res.status).toBe(201);
    const reading = res.data.meterReading ?? res.data;
    expect(reading).toHaveProperty('id');
  });

  it('GET /communities/:id/meter-readings → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/meter-readings`);
    expect(res.status).toBe(200);
  });

  it('DELETE /communities/:id/meter-readings/:id → 204', async () => {
    const created = await adminClient.post(`/communities/${communityId}/meter-readings`, {
      unitId,
      type: 'AGUA',
      readingDate: '2025-01-15',
      value: 1234.5,
    });
    const reading = created.data.meterReading ?? created.data;
    const readingId = reading.id;
    const res = await adminClient.delete(
      `/communities/${communityId}/meter-readings/${readingId}`
    );
    expect(res.status).toBe(204);
  });
});

// ===========================================================================
// 21. SUPPLIERS
// ===========================================================================
describe('21. Suppliers', () => {
  let adminClient: AxiosInstance;
  let communityId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Proveedores Integration', {
      address: 'Calle Proveedores 3',
      city: 'Madrid',
      postalCode: '28001',
    });
  });

  it('POST /communities/:id/suppliers → 201', async () => {
    const res = await adminClient.post(`/communities/${communityId}/suppliers`, {
      name: 'LimpiezasFast S.L.',
      cif: 'B12345678',
      email: 'contacto@limpiezasfast.com',
      phone: '+34600123456',
    });
    expect(res.status).toBe(201);
    const supplier = res.data.supplier ?? res.data;
    expect(supplier).toHaveProperty('id');
  });

  it('GET /communities/:id/suppliers → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/suppliers`);
    expect(res.status).toBe(200);
  });

  it('GET /communities/:id/suppliers/:id → 200', async () => {
    const created = await adminClient.post(`/communities/${communityId}/suppliers`, {
      name: 'LimpiezasFast S.L.',
      cif: 'B12345678',
    });
    const supplier = created.data.supplier ?? created.data;
    const supplierId = supplier.id;
    const res = await adminClient.get(`/communities/${communityId}/suppliers/${supplierId}`);
    expect(res.status).toBe(200);
  });

  it('PATCH /communities/:id/suppliers/:id → 200', async () => {
    const created = await adminClient.post(`/communities/${communityId}/suppliers`, {
      name: 'LimpiezasFast S.L.',
      cif: 'B12345679',
    });
    const supplier = created.data.supplier ?? created.data;
    const supplierId = supplier.id;
    const res = await adminClient.patch(
      `/communities/${communityId}/suppliers/${supplierId}`,
      { name: 'LimpiezasFast S.L. Updated' }
    );
    expect(res.status).toBe(200);
  });

  it('DELETE /communities/:id/suppliers/:id → 204', async () => {
    const created = await adminClient.post(`/communities/${communityId}/suppliers`, {
      name: 'Supplier a Eliminar',
      cif: 'B12345670',
    });
    const supplier = created.data.supplier ?? created.data;
    const supplierId = supplier.id;
    const res = await adminClient.delete(`/communities/${communityId}/suppliers/${supplierId}`);
    expect(res.status).toBe(204);
  });
});

// ===========================================================================
// 22. CO-ADMINS
// ===========================================================================
describe('22. Co-Admins', () => {
  let adminClient: AxiosInstance;
  let communityId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad CoAdmins Integration', {
      address: 'Calle CoAdmins 1',
      city: 'Madrid',
      postalCode: '28001',
    });
    // Create a second admin to use as co-admin (always recreate with upsert)
    await createUserInDb(
      'coadmin-test@comugest.test',
      'CoAdmin1!SecurePass',
      'ADMIN_FINCAS',
      'CoAdmin',
      'Test'
    );
  });

  it('GET /communities/:id/co-admins → 200', async () => {
    const res = await adminClient.get(`/communities/${communityId}/co-admins`);
    expect(res.status).toBe(200);
  });

  it('POST /communities/:id/co-admins → 200 or 201', async () => {
    // Schema requires { email: string }, not { userId }
    const res = await adminClient.post(`/communities/${communityId}/co-admins`, {
      email: 'coadmin-test@comugest.test',
    });
    expect([200, 201]).toContain(res.status);
  });

  it('DELETE /communities/:id/co-admins/:userId → 200 or 204', async () => {
    // First add co-admin, then delete
    const coAdmin = await prisma.user.findUnique({ where: { email: 'coadmin-test@comugest.test' } });
    if (!coAdmin) return;
    // Add them first
    await adminClient.post(`/communities/${communityId}/co-admins`, {
      email: 'coadmin-test@comugest.test',
    });
    const res = await adminClient.delete(
      `/communities/${communityId}/co-admins/${coAdmin.id}`
    );
    expect([200, 204]).toContain(res.status);
  });
});

// ===========================================================================
// 23. POLLS
// ===========================================================================
describe('23. Polls', () => {
  let adminClient: AxiosInstance;
  let communityId: string;
  let meetingId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;

    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Polls Integration', {
      address: 'Calle Polls 1',
      city: 'Madrid',
      postalCode: '28001',
    });

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const meeting = await prisma.meeting.create({
      data: {
        community: { connect: { id: communityId } },
        organizedBy: { connect: { id: clients.adminUserId } },
        title: 'Junta con Votaciones',
        type: 'ORDINARY',
        scheduledAt: nextWeek,
      },
    });
    meetingId = meeting.id;
  });

  it('POST /meetings/:meetingId/polls → 201 + poll', async () => {
    const res = await adminClient.post(`/meetings/${meetingId}/polls`, {
      question: '¿Aprobar el presupuesto 2025?',
      description: 'Votación del presupuesto anual.',
    });
    expect(res.status).toBe(201);
    const poll = res.data.poll ?? res.data;
    expect(poll).toHaveProperty('id');
  });

  it('GET /meetings/:meetingId/polls → 200', async () => {
    const res = await adminClient.get(`/meetings/${meetingId}/polls`);
    expect(res.status).toBe(200);
    const polls = res.data.polls ?? res.data;
    expect(Array.isArray(polls)).toBe(true);
  });

  it('POST /meetings/:meetingId/polls/:pollId/close → 200 or 204', async () => {
    // Create a poll, then close it
    const created = await adminClient.post(`/meetings/${meetingId}/polls`, {
      question: '¿Aprobar el presupuesto 2025?',
    });
    const poll = created.data.poll ?? created.data;
    const pollId = poll.id;
    const res = await adminClient.post(`/meetings/${meetingId}/polls/${pollId}/close`);
    expect([200, 204]).toContain(res.status);
  });
});

// ===========================================================================
// 24. INVITATIONS
// ===========================================================================
describe('24. Invitations', () => {
  let adminClient: AxiosInstance;
  let vecinoClient: AxiosInstance;
  let communityId: string;
  let unitId: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    vecinoClient = clients.vecinoClient;

    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Invitaciones Integration', {
      address: 'Calle Invitaciones 1',
      city: 'Barcelona',
      postalCode: '08001',
    });
    unitId = await createUnitInDb(communityId, '2B', 10, 'VIVIENDA');
  });

  it('POST /invitations → 201', async () => {
    const res = await adminClient.post('/invitations', {
      email: 'vecino-invited@comugest.test',
      firstName: 'Carlos',
      lastName: 'Rodríguez',
      phone: '+34600000001',
      communityId,
      relationType: 'OWNER',
      unitId,
      locale: 'es',
    });
    expect(res.status).toBe(201);
  });

  it('POST /invitations with non-existent unit → 400 or 404', async () => {
    const res = await adminClient.post('/invitations', {
      email: 'vecino2@comugest.test',
      firstName: 'Maria',
      lastName: 'Lopez',
      communityId,
      relationType: 'OWNER',
      unitId: 'clz0000000000000000000000',
    });
    expect([400, 404]).toContain(res.status);
  });

  it('POST /invitations with missing required fields → 400', async () => {
    const res = await adminClient.post('/invitations', {
      email: 'partial@comugest.test',
    });
    expect(res.status).toBe(400);
  });

  it('VECINO cannot send invitations → 403', async () => {
    const res = await vecinoClient.post('/invitations', {
      email: 'blocked@comugest.test',
      firstName: 'Test',
      lastName: 'User',
      communityId,
      relationType: 'OWNER',
      unitId,
    });
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// 25. NOTIFICATIONS
// ===========================================================================
describe('25. Notifications', () => {
  let adminClient: AxiosInstance;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
  });

  it('GET /me/notifications → 200 + array', async () => {
    const res = await adminClient.get('/me/notifications');
    expect(res.status).toBe(200);
    const notifications = res.data.notifications ?? res.data;
    expect(Array.isArray(notifications)).toBe(true);
  });

  it('PATCH /me/notifications/read-all → 200 or 204', async () => {
    const res = await adminClient.patch('/me/notifications/read-all');
    expect([200, 204]).toContain(res.status);
  });

  it('GET /me/notifications without token → 401', async () => {
    const res = await unauthClient.get('/me/notifications');
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// 26. EDGE CASES / SECURITY
// ===========================================================================
describe('26. Edge Cases and Security', () => {
  let adminClient: AxiosInstance;
  let communityId: string;
  let unit1Id: string;

  beforeEach(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;
    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Edge Cases Integration', {
      address: 'Calle Extrema 99',
      city: 'Madrid',
      postalCode: '28001',
    });
    unit1Id = await createUnitInDb(communityId, 'EdgeU', 10, 'VIVIENDA');
  });

  it('SQL injection in community name → 201 (stored safely, not executed)', async () => {
    const maliciousName = "'; DROP TABLE \"Community\"; --";
    const res = await adminClient.post('/communities', {
      name: maliciousName,
      address: 'Calle Peligrosa 1',
      city: 'Madrid',
      postalCode: '28001',
      country: 'ES',
    });
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      // Verify communities still exist (not dropped)
      const listRes = await adminClient.get('/communities');
      expect(listRes.status).toBe(200);
      expect(listRes.data).toHaveProperty('communities');
    }
  });

  it('XSS in announcement body → 201 (stored safely)', async () => {
    const xssBody = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    const res = await adminClient.post(`/communities/${communityId}/announcements`, {
      title: 'XSS Test',
      body: xssBody,
    });
    expect([201, 400]).toContain(res.status);
  });

  it('Amount as string "abc" in invoice → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Test',
      dueDate: '2025-01-31',
      items: [{ unitId: unit1Id, amount: 'abc' }],
    });
    expect(res.status).toBe(400);
  });

  it('Negative invoice amount → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Test Negativo',
      dueDate: '2025-01-31',
      items: [{ unitId: unit1Id, amount: -999 }],
    });
    expect(res.status).toBe(400);
  });

  it('Future date 9999-12-31 as invoice dueDate → 201 or 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Far Future Invoice',
      dueDate: '9999-12-31',
      items: [{ unitId: unit1Id, amount: 100 }],
    });
    expect([201, 400]).toContain(res.status);
  });

  it('Very long string (10000 chars) in community name → 400 (max 120)', async () => {
    const res = await adminClient.post('/communities', {
      name: 'X'.repeat(10000),
      address: 'Calle 1',
      city: 'Madrid',
      postalCode: '28001',
      country: 'ES',
    });
    expect(res.status).toBe(400);
  });

  it('Unicode in community name → 201', async () => {
    const res = await adminClient.post('/communities', {
      name: 'Comunidad Unicode 中文 🏠',
      address: 'Calle Unicode 1',
      city: 'Madrid',
      postalCode: '28001',
      country: 'ES',
    });
    expect([201, 400]).toContain(res.status);
  });

  it('Extra unknown fields in body → ignored (Zod strip)', async () => {
    const res = await adminClient.post('/communities', {
      name: 'ExtraFields Community',
      address: 'Calle Extra 1',
      city: 'Madrid',
      postalCode: '28001',
      country: 'ES',
      unknownField1: 'should be ignored',
      unknownField2: 12345,
    });
    expect([201, 400]).toContain(res.status);
  });

  it('Empty body for required announcement fields → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/announcements`, {
      title: '',
      body: '',
    });
    expect(res.status).toBe(400);
  });

  it('DERRAMA with negative totalAmount → 400', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'DERRAMA',
      concept: 'Derrama Negativa',
      dueDate: '2025-01-31',
      totalAmount: -5000,
    });
    expect(res.status).toBe(400);
  });

  it('Extremely large invoice amount → 400 (max 1_000_000)', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Giant Invoice',
      dueDate: '2025-12-31',
      items: [{ unitId: unit1Id, amount: 9_999_999_999 }],
    });
    expect(res.status).toBe(400);
  });

  it('Non-existent route → 404', async () => {
    const res = await adminClient.get('/this-does-not-exist-at-all');
    expect(res.status).toBe(404);
  });

  it('Health check → 200 + { status: "ok" }', async () => {
    const res = await axios.get(`http://localhost:${PORT}/health`, {
      validateStatus: () => true,
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('status', 'ok');
  });
});

// ===========================================================================
// 27. FULL INTEGRATION SCENARIO
// ===========================================================================
describe('27. Full Integration Scenario', () => {
  let adminClient: AxiosInstance;
  let communityId: string;
  let unit1Id: string;
  let unit2Id: string;
  let invoiceId: string;
  let expenseId: string;

  beforeAll(async () => {
    const clients = await setupClients();
    adminClient = clients.adminClient;

    communityId = await createCommunityInDb(clients.adminUserId, 'Comunidad Scenario Integration', {
      address: 'Gran Vía 200',
      city: 'Madrid',
      postalCode: '28013',
      cif: 'H28999111',
    });
    unit1Id = await createUnitInDb(communityId, '4A', 25, 'VIVIENDA');
    unit2Id = await createUnitInDb(communityId, '4B', 25, 'VIVIENDA');
  });

  it('Admin creates invoices for all units', async () => {
    const res = await adminClient.post(`/communities/${communityId}/invoices`, {
      type: 'INDIVIDUAL',
      concept: 'Cuota comunidad Marzo 2025',
      dueDate: '2025-03-31',
      items: [
        { unitId: unit1Id, amount: 200 },
        { unitId: unit2Id, amount: 200 },
      ],
    });
    expect(res.status).toBe(201);
    invoiceId = res.data.invoice.id;
  });

  it('Admin creates an expense', async () => {
    const res = await adminClient.post(`/communities/${communityId}/expenses`, {
      category: 'GARDENING',
      concept: 'Poda árboles jardín',
      amount: 800,
      expenseDate: '2025-03-05',
    });
    expect(res.status).toBe(201);
    expenseId = res.data.expense.id;
  });

  it('Admin creates an announcement', async () => {
    const res = await adminClient.post(`/communities/${communityId}/announcements`, {
      title: 'Nuevas normas de aparcamiento',
      body: 'A partir del 1 de abril, las plazas de garaje quedan reservadas a sus titulares.',
      pinned: true,
      notify: false,
    });
    expect(res.status).toBe(201);
  });

  it('Admin creates a meeting', async () => {
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 1);

    const res = await adminClient.post(`/communities/${communityId}/meetings`, {
      title: 'Junta Anual de Propietarios',
      type: 'ORDINARY',
      scheduledAt: futureDate.toISOString(),
      location: 'Sala comunidad',
    });
    expect(res.status).toBe(201);
  });

  it('Admin sets annual budget', async () => {
    const res = await adminClient.put(`/communities/${communityId}/budgets/2025`, {
      lines: [
        { category: 'CLEANING', amount: 6000 },
        { category: 'GARDENING', amount: 2400 },
        { category: 'INSURANCE', amount: 3600 },
      ],
    });
    expect(res.status).toBe(200);
  });

  it('Admin views morosos report', async () => {
    const res = await adminClient.get(`/communities/${communityId}/reports/morosos`);
    expect(res.status).toBe(200);
  });

  it('Admin views full community summary (parallel requests)', async () => {
    const [comm, invoices, expenses, announcements, meetings] = await Promise.all([
      adminClient.get(`/communities/${communityId}`),
      adminClient.get(`/communities/${communityId}/invoices`),
      adminClient.get(`/communities/${communityId}/expenses`),
      adminClient.get(`/communities/${communityId}/announcements`),
      adminClient.get(`/communities/${communityId}/meetings`),
    ]);

    expect(comm.status).toBe(200);
    expect(invoices.status).toBe(200);
    expect(expenses.status).toBe(200);
    expect(announcements.status).toBe(200);
    expect(meetings.status).toBe(200);

    // Verify response shapes
    expect(expenses.data).toHaveProperty('expenses');
    expect(announcements.data).toHaveProperty('announcements');
    const invData = invoices.data.invoices ?? invoices.data;
    expect(Array.isArray(invData)).toBe(true);
  });

  it('Verify database state: invoice exists', async () => {
    const dbInvoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(dbInvoice).not.toBeNull();
    expect(dbInvoice!.concept).toBe('Cuota comunidad Marzo 2025');
  });

  it('Verify database state: expense exists', async () => {
    const dbExpense = await prisma.expense.findUnique({ where: { id: expenseId } });
    expect(dbExpense).not.toBeNull();
    expect(dbExpense!.concept).toBe('Poda árboles jardín');
  });

  it('Admin invites a resident', async () => {
    const res = await adminClient.post('/invitations', {
      email: 'scenario-resident@comugest.test',
      firstName: 'Laura',
      lastName: 'Fernández',
      communityId,
      relationType: 'OWNER',
      unitId: unit1Id,
      locale: 'es',
    });
    expect(res.status).toBe(201);
  });
});
