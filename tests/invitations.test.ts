import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { generateVerificationToken } from '../src/utils/tokens';
import { cleanup, createCommunity, createUnit, createUser } from './helpers';

const app = createApp();

describe('Invitations endpoints', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/invitations (admin crea)', () => {
    it('crea usuario INVITED, vincula unit y genera token (201)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);

      const inviteeEmail = `invitee-${Date.now()}@test.example.com`;
      const res = await request(app)
        .post('/api/v1/invitations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          email: inviteeEmail,
          firstName: 'Ana',
          lastName: 'Pérez',
          communityId: community.id,
          unitId: unit.id,
          relationType: 'OWNER',
        });
      expect(res.status).toBe(201);
      expect(res.body.sentTo).toBe(inviteeEmail);

      const created = await prisma.user.findUnique({ where: { email: inviteeEmail } });
      expect(created?.status).toBe('INVITED');

      const ownership = await prisma.ownership.findFirst({
        where: { unitId: unit.id, ownerId: created!.id, endDate: null },
      });
      expect(ownership).not.toBeNull();

      const tokenRecord = await prisma.verificationToken.findFirst({
        where: { userId: created!.id, type: 'INVITATION', usedAt: null },
      });
      expect(tokenRecord).not.toBeNull();
    });

    it('relationType=BOTH crea ownership Y occupancy', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);

      const inviteeEmail = `both-${Date.now()}@test.example.com`;
      const res = await request(app)
        .post('/api/v1/invitations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          email: inviteeEmail,
          firstName: 'X',
          lastName: 'Y',
          communityId: community.id,
          unitId: unit.id,
          relationType: 'BOTH',
        });
      expect(res.status).toBe(201);
      const user = await prisma.user.findUnique({ where: { email: inviteeEmail } });
      const own = await prisma.ownership.count({ where: { unitId: unit.id, ownerId: user!.id, endDate: null } });
      const occ = await prisma.occupancy.count({ where: { unitId: unit.id, occupantId: user!.id, endDate: null } });
      expect(own).toBe(1);
      expect(occ).toBe(1);
    });

    it('si el invitado ya tiene cuenta ACTIVE, devuelve 409 y vincula la unidad', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);
      const existing = await createUser({ role: 'VECINO' });

      const res = await request(app)
        .post('/api/v1/invitations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          email: existing.email,
          firstName: 'X',
          lastName: 'Y',
          communityId: community.id,
          unitId: unit.id,
          relationType: 'OWNER',
        });
      expect(res.status).toBe(409);
      const own = await prisma.ownership.findFirst({
        where: { unitId: unit.id, ownerId: existing.id, endDate: null },
      });
      expect(own).not.toBeNull();
    });

    it('admin no gestiona la comunidad (403)', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });
      const unit = await createUnit(community.id);

      const res = await request(app)
        .post('/api/v1/invitations')
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({
          email: `x-${Date.now()}@test.example.com`,
          firstName: 'X',
          lastName: 'Y',
          communityId: community.id,
          unitId: unit.id,
          relationType: 'OWNER',
        });
      expect(res.status).toBe(403);
    });

    it('unidad no pertenece a la comunidad → 404', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const otherCommunity = await createCommunity({ adminId: admin.id });
      const foreignUnit = await createUnit(otherCommunity.id);

      const res = await request(app)
        .post('/api/v1/invitations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          email: `x-${Date.now()}@test.example.com`,
          firstName: 'X',
          lastName: 'Y',
          communityId: community.id,
          unitId: foreignUnit.id,
          relationType: 'OWNER',
        });
      expect(res.status).toBe(404);
    });

    it('vecino no puede crear invitaciones (403)', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .post('/api/v1/invitations')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/invitations/inspect', () => {
    async function createInvite(): Promise<{
      rawToken: string;
      userId: string;
      communityName: string;
    }> {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id, name: 'Olmo' });
      const unit = await createUnit(community.id);
      const user = await prisma.user.create({
        data: {
          email: `inv-${Date.now()}-${Math.random()}@test.example.com`,
          firstName: 'Z',
          lastName: 'W',
          role: 'VECINO',
          status: 'INVITED',
        },
      });
      const { token, tokenHash } = generateVerificationToken();
      await prisma.verificationToken.create({
        data: {
          tokenHash,
          type: 'INVITATION',
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          metadata: { unitId: unit.id, communityId: community.id, relationType: 'OWNER' },
        },
      });
      return { rawToken: token, userId: user.id, communityName: community.name };
    }

    it('devuelve metadatos públicos con token válido', async () => {
      const { rawToken, communityName } = await createInvite();
      const res = await request(app).get(`/api/v1/invitations/inspect?token=${encodeURIComponent(rawToken)}`);
      expect(res.status).toBe(200);
      expect(res.body.communityName).toBe(communityName);
      expect(res.body.email).toContain('@test.example.com');
    });

    it('rechaza token inválido con 404', async () => {
      const res = await request(app).get('/api/v1/invitations/inspect?token=invalid');
      expect(res.status).toBe(404);
    });

    it('rechaza token caducado con 400', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);
      const user = await prisma.user.create({
        data: {
          email: `exp-${Date.now()}@test.example.com`,
          firstName: 'X',
          lastName: 'Y',
          role: 'VECINO',
          status: 'INVITED',
        },
      });
      const { token, tokenHash } = generateVerificationToken();
      await prisma.verificationToken.create({
        data: {
          tokenHash,
          type: 'INVITATION',
          userId: user.id,
          expiresAt: new Date(Date.now() - 1000),
          metadata: { unitId: unit.id, communityId: community.id, relationType: 'OWNER' },
        },
      });
      const res = await request(app).get(`/api/v1/invitations/inspect?token=${encodeURIComponent(token)}`);
      expect(res.status).toBe(400);
    });

    it('rechaza token ya usado con 400', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);
      const user = await prisma.user.create({
        data: {
          email: `used-${Date.now()}@test.example.com`,
          firstName: 'X',
          lastName: 'Y',
          role: 'VECINO',
          status: 'ACTIVE',
        },
      });
      const { token, tokenHash } = generateVerificationToken();
      await prisma.verificationToken.create({
        data: {
          tokenHash,
          type: 'INVITATION',
          userId: user.id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          usedAt: new Date(),
          metadata: { unitId: unit.id, communityId: community.id, relationType: 'OWNER' },
        },
      });
      const res = await request(app).get(`/api/v1/invitations/inspect?token=${encodeURIComponent(token)}`);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/invitations/accept', () => {
    async function newInvite(): Promise<{ rawToken: string; email: string; userId: string }> {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);
      const email = `acc-${Date.now()}-${Math.random()}@test.example.com`;
      const user = await prisma.user.create({
        data: { email, firstName: 'X', lastName: 'Y', role: 'VECINO', status: 'INVITED' },
      });
      const { token, tokenHash } = generateVerificationToken();
      await prisma.verificationToken.create({
        data: {
          tokenHash,
          type: 'INVITATION',
          userId: user.id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
          metadata: { unitId: unit.id, communityId: community.id, relationType: 'OWNER' },
        },
      });
      return { rawToken: token, email, userId: user.id };
    }

    it('aceptar activa al usuario y devuelve tokens', async () => {
      const { rawToken, userId } = await newInvite();
      const res = await request(app)
        .post('/api/v1/invitations/accept')
        .send({ token: rawToken, password: 'StrongPass1', gdprAccepted: true });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.status).toBe('ACTIVE');
      expect(user?.passwordHash).not.toBeNull();
    });

    it('rechaza contraseña débil (400)', async () => {
      const { rawToken } = await newInvite();
      const res = await request(app)
        .post('/api/v1/invitations/accept')
        .send({ token: rawToken, password: 'weak', gdprAccepted: true });
      expect(res.status).toBe(400);
    });

    it('rechaza sin aceptar GDPR (400)', async () => {
      const { rawToken } = await newInvite();
      const res = await request(app)
        .post('/api/v1/invitations/accept')
        .send({ token: rawToken, password: 'StrongPass1', gdprAccepted: false });
      expect(res.status).toBe(400);
    });

    it('no se puede usar dos veces el mismo token (400)', async () => {
      const { rawToken } = await newInvite();
      const r1 = await request(app)
        .post('/api/v1/invitations/accept')
        .send({ token: rawToken, password: 'StrongPass1', gdprAccepted: true });
      expect(r1.status).toBe(200);
      const r2 = await request(app)
        .post('/api/v1/invitations/accept')
        .send({ token: rawToken, password: 'StrongPass1', gdprAccepted: true });
      expect(r2.status).toBe(400);
    });

    it('rechaza token inválido (404)', async () => {
      const res = await request(app)
        .post('/api/v1/invitations/accept')
        .send({ token: 'definitely-not-a-token', password: 'StrongPass1', gdprAccepted: true });
      expect(res.status).toBe(404);
    });
  });
});
