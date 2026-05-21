import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import {
  cleanup,
  createCommunity,
  createUnit,
  createUser,
  setOccupant,
} from './helpers';

const app = createApp();

describe('Procedures endpoints', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function setupResident(): Promise<{
    admin: Awaited<ReturnType<typeof createUser>>;
    vecino: Awaited<ReturnType<typeof createUser>>;
    community: Awaited<ReturnType<typeof createCommunity>>;
    unit: Awaited<ReturnType<typeof createUnit>>;
  }> {
    const admin = await createUser({ role: 'ADMIN_FINCAS' });
    const vecino = await createUser({ role: 'VECINO' });
    const community = await createCommunity({ adminId: admin.id });
    const unit = await createUnit(community.id);
    await setOccupant(unit.id, vecino.id);
    return { admin, vecino, community, unit };
  }

  describe('POST /api/v1/procedures (vecino crea)', () => {
    it('crea trámite (201) y queda en SUBMITTED', async () => {
      const { vecino, community, unit } = await setupResident();
      const res = await request(app)
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({
          communityId: community.id,
          type: 'CERTIFICATE',
          subject: 'Certificado al corriente',
          description: 'Para venta del piso',
          unitId: unit.id,
        });
      expect(res.status).toBe(201);
      expect(res.body.procedure.status).toBe('SUBMITTED');
      expect(res.body.procedure.requesterId).toBe(vecino.id);
    });

    it('rechaza vecino que no pertenece a la comunidad (403)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const otherVecino = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${otherVecino.token}`)
        .send({
          communityId: community.id,
          type: 'CERTIFICATE',
          subject: 'X',
          description: 'Y',
        });
      expect(res.status).toBe(403);
    });

    it('rechaza unitId de otra comunidad (404)', async () => {
      const { vecino, community } = await setupResident();
      const otherCommunity = await createCommunity();
      const foreignUnit = await createUnit(otherCommunity.id);

      const res = await request(app)
        .post('/api/v1/procedures')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({
          communityId: community.id,
          type: 'MAINTENANCE',
          subject: 'X',
          description: 'Y',
          unitId: foreignUnit.id,
        });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/me/procedures', () => {
    it('lista mis trámites', async () => {
      const { vecino, community } = await setupResident();
      await prisma.procedure.create({
        data: {
          communityId: community.id,
          requesterId: vecino.id,
          type: 'COMPLAINT',
          subject: 'Ruido',
          description: 'Vecinos del 5o',
        },
      });
      const res = await request(app)
        .get('/api/v1/me/procedures')
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(200);
      expect(res.body.procedures).toHaveLength(1);
    });
  });

  describe('GET /api/v1/communities/:communityId/procedures (admin)', () => {
    it('admin de la comunidad lista los trámites', async () => {
      const { admin, vecino, community } = await setupResident();
      await prisma.procedure.create({
        data: {
          communityId: community.id,
          requesterId: vecino.id,
          type: 'CERTIFICATE',
          subject: 'X',
          description: 'Y',
        },
      });
      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/procedures`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.procedures).toHaveLength(1);
    });

    it('filtra por status', async () => {
      const { admin, vecino, community } = await setupResident();
      await prisma.procedure.createMany({
        data: [
          { communityId: community.id, requesterId: vecino.id, type: 'CERTIFICATE', subject: 'a', description: 'x', status: 'SUBMITTED' },
          { communityId: community.id, requesterId: vecino.id, type: 'CERTIFICATE', subject: 'b', description: 'y', status: 'COMPLETED' },
        ],
      });
      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/procedures?status=COMPLETED`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.procedures.every((p: { status: string }) => p.status === 'COMPLETED')).toBe(true);
    });

    it('admin ajeno no accede (403)', async () => {
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const { community } = await setupResident();
      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/procedures`)
        .set('Authorization', `Bearer ${intruder.token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/procedures/:id (detalle)', () => {
    it('requester accede y ve canManage=false', async () => {
      const { vecino, community } = await setupResident();
      const p = await prisma.procedure.create({
        data: { communityId: community.id, requesterId: vecino.id, type: 'COMPLAINT', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .get(`/api/v1/procedures/${p.id}`)
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(200);
      expect(res.body.procedure.canManage).toBe(false);
    });

    it('admin de la comunidad accede y ve canManage=true', async () => {
      const { admin, vecino, community } = await setupResident();
      const p = await prisma.procedure.create({
        data: { communityId: community.id, requesterId: vecino.id, type: 'COMPLAINT', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .get(`/api/v1/procedures/${p.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.procedure.canManage).toBe(true);
    });

    it('tercero sin relación recibe 403', async () => {
      const { vecino, community } = await setupResident();
      const intruder = await createUser({ role: 'VECINO' });
      const p = await prisma.procedure.create({
        data: { communityId: community.id, requesterId: vecino.id, type: 'OTHER', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .get(`/api/v1/procedures/${p.id}`)
        .set('Authorization', `Bearer ${intruder.token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/v1/procedures/:id (admin)', () => {
    it('admin marca COMPLETED y fija resolvedAt y handledById', async () => {
      const { admin, vecino, community } = await setupResident();
      const p = await prisma.procedure.create({
        data: { communityId: community.id, requesterId: vecino.id, type: 'CERTIFICATE', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .patch(`/api/v1/procedures/${p.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'COMPLETED', resolution: 'Resuelto' });
      expect(res.status).toBe(200);
      expect(res.body.procedure.status).toBe('COMPLETED');
      expect(res.body.procedure.resolvedAt).not.toBeNull();
      expect(res.body.procedure.handledById).toBe(admin.id);
    });

    it('volver a IN_PROGRESS limpia resolvedAt', async () => {
      const { admin, vecino, community } = await setupResident();
      const p = await prisma.procedure.create({
        data: {
          communityId: community.id,
          requesterId: vecino.id,
          type: 'CERTIFICATE',
          subject: 'x',
          description: 'y',
          status: 'COMPLETED',
          resolvedAt: new Date(),
        },
      });
      const res = await request(app)
        .patch(`/api/v1/procedures/${p.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'IN_PROGRESS' });
      expect(res.status).toBe(200);
      expect(res.body.procedure.resolvedAt).toBeNull();
    });

    it('admin ajeno no puede modificar (403)', async () => {
      const { vecino, community } = await setupResident();
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const p = await prisma.procedure.create({
        data: { communityId: community.id, requesterId: vecino.id, type: 'OTHER', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .patch(`/api/v1/procedures/${p.id}`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ status: 'COMPLETED' });
      expect(res.status).toBe(403);
    });

    it('vecino requester no puede modificar (requireRole 403)', async () => {
      const { vecino, community } = await setupResident();
      const p = await prisma.procedure.create({
        data: { communityId: community.id, requesterId: vecino.id, type: 'OTHER', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .patch(`/api/v1/procedures/${p.id}`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ status: 'COMPLETED' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/procedures/:id/updates', () => {
    it('requester añade comentario en el hilo (201)', async () => {
      const { vecino, community } = await setupResident();
      const p = await prisma.procedure.create({
        data: { communityId: community.id, requesterId: vecino.id, type: 'OTHER', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .post(`/api/v1/procedures/${p.id}/updates`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ body: 'Más info' });
      expect(res.status).toBe(201);
      expect(res.body.update.body).toBe('Más info');
    });

    it('admin de la comunidad puede comentar (201)', async () => {
      const { admin, vecino, community } = await setupResident();
      const p = await prisma.procedure.create({
        data: { communityId: community.id, requesterId: vecino.id, type: 'OTHER', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .post(`/api/v1/procedures/${p.id}/updates`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ body: 'Recibido' });
      expect(res.status).toBe(201);
    });

    it('tercero sin acceso recibe 403', async () => {
      const { vecino, community } = await setupResident();
      const intruder = await createUser({ role: 'VECINO' });
      const p = await prisma.procedure.create({
        data: { communityId: community.id, requesterId: vecino.id, type: 'OTHER', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .post(`/api/v1/procedures/${p.id}/updates`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ body: 'Hack' });
      expect(res.status).toBe(403);
    });
  });
});
