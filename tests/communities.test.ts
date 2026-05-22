import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { cleanup, createCommunity, createUnit, createUser, setOccupant } from './helpers';

const app = createApp();

describe('Communities endpoints', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/communities', () => {
    it('un ADMIN_FINCAS crea comunidad y queda vinculado como admin', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });

      const res = await request(app)
        .post('/api/v1/communities')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          name: 'Edificio Olmo',
          address: 'C/ Mayor 5',
          city: 'Madrid',
          postalCode: '28013',
          country: 'ES',
        });

      expect(res.status).toBe(201);
      expect(res.body.community.name).toBe('Edificio Olmo');

      const link = await prisma.communityAdmin.findFirst({
        where: { communityId: res.body.community.id, userId: admin.id },
      });
      expect(link).not.toBeNull();
    });

    it('permite crear con unidades anidadas en una transacción', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });

      const res = await request(app)
        .post('/api/v1/communities')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          name: 'Edificio Roble',
          address: 'C/ Nueva 2',
          city: 'Madrid',
          postalCode: '28014',
          country: 'ES',
          units: [
            { type: 'VIVIENDA', label: '1A', coefficient: 50 },
            { type: 'VIVIENDA', label: '1B', coefficient: 50 },
          ],
        });

      expect(res.status).toBe(201);
      const units = await prisma.unit.findMany({ where: { communityId: res.body.community.id } });
      expect(units).toHaveLength(2);
    });

    it('rechaza si la suma de coeficientes supera 100', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });

      const res = await request(app)
        .post('/api/v1/communities')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          name: 'Edificio Inválido',
          address: 'C/ X',
          city: 'Madrid',
          postalCode: '28001',
          country: 'ES',
          units: [
            { type: 'VIVIENDA', label: 'A', coefficient: 60 },
            { type: 'VIVIENDA', label: 'B', coefficient: 60 },
          ],
        });

      expect(res.status).toBe(400);
    });

    it('rechaza etiquetas de unidad duplicadas', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });

      const res = await request(app)
        .post('/api/v1/communities')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          name: 'Edificio Dup',
          address: 'C/ X',
          city: 'Madrid',
          postalCode: '28001',
          country: 'ES',
          units: [
            { type: 'VIVIENDA', label: '1A', coefficient: 50 },
            { type: 'VIVIENDA', label: '1A', coefficient: 50 },
          ],
        });

      expect(res.status).toBe(400);
    });

    it('un VECINO no puede crear comunidades (403)', async () => {
      const vecino = await createUser({ role: 'VECINO' });

      const res = await request(app)
        .post('/api/v1/communities')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({
          name: 'X',
          address: 'X',
          city: 'X',
          postalCode: '28001',
          country: 'ES',
        });

      expect(res.status).toBe(403);
    });

    it('sin token responde 401', async () => {
      const res = await request(app).post('/api/v1/communities').send({});
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/communities', () => {
    it('un ADMIN_FINCAS solo ve sus comunidades', async () => {
      const adminA = await createUser({ role: 'ADMIN_FINCAS' });
      const adminB = await createUser({ role: 'ADMIN_FINCAS' });
      await createCommunity({ adminId: adminA.id });
      await createCommunity({ adminId: adminA.id });
      await createCommunity({ adminId: adminB.id });

      const res = await request(app)
        .get('/api/v1/communities')
        .set('Authorization', `Bearer ${adminA.token}`);

      expect(res.status).toBe(200);
      const names = res.body.communities.map((c: { id: string }) => c.id);
      expect(names.length).toBeGreaterThanOrEqual(2);
      // adminA solo ve las suyas (no las de adminB)
      const linksA = await prisma.communityAdmin.findMany({ where: { userId: adminA.id } });
      const expectedIds = new Set(linksA.map((l) => l.communityId));
      for (const id of names) {
        expect(expectedIds.has(id)).toBe(true);
      }
    });

    it('un SUPPORT ve todas las comunidades', async () => {
      const support = await createUser({ role: 'SUPPORT' });
      const totalBefore = await prisma.community.count();

      const res = await request(app)
        .get('/api/v1/communities')
        .set('Authorization', `Bearer ${support.token}`);

      expect(res.status).toBe(200);
      expect(res.body.communities.length).toBe(totalBefore);
    });
  });

  describe('GET /api/v1/communities/:id', () => {
    it('admin de la comunidad accede al detalle (200)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      await createUnit(community.id, { label: 'UD-1' });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.community.id).toBe(community.id);
      expect(res.body.community.units).toHaveLength(1);
    });

    it('admin AJENO recibe 403', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}`)
        .set('Authorization', `Bearer ${intruder.token}`);

      expect(res.status).toBe(403);
    });

    it('SUPPORT accede a cualquier comunidad', async () => {
      const support = await createUser({ role: 'SUPPORT' });
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}`)
        .set('Authorization', `Bearer ${support.token}`);

      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /api/v1/communities/:id', () => {
    it('admin de la comunidad puede actualizar', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .patch(`/api/v1/communities/${community.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ city: 'Barcelona' });

      expect(res.status).toBe(200);
      expect(res.body.community.city).toBe('Barcelona');
    });

    it('admin ajeno no puede actualizar (403)', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });

      const res = await request(app)
        .patch(`/api/v1/communities/${community.id}`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ city: 'Barcelona' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/communities/:id', () => {
    it('borra una comunidad sin ocupantes (204)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .delete(`/api/v1/communities/${community.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(204);
      const stillThere = await prisma.community.findUnique({ where: { id: community.id } });
      expect(stillThere).toBeNull();
    });

    it('rechaza con 409 si tiene ocupantes activos', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);
      await setOccupant(unit.id, vecino.id);

      const res = await request(app)
        .delete(`/api/v1/communities/${community.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/v1/me/communities', () => {
    it('un vecino ve solo las comunidades donde ocupa unidad', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const com1 = await createCommunity({ adminId: admin.id });
      const com2 = await createCommunity({ adminId: admin.id });
      const unit1 = await createUnit(com1.id);
      await createUnit(com2.id);
      await setOccupant(unit1.id, vecino.id);

      const res = await request(app)
        .get('/api/v1/me/communities')
        .set('Authorization', `Bearer ${vecino.token}`);

      expect(res.status).toBe(200);
      expect(res.body.communities).toHaveLength(1);
      expect(res.body.communities[0].id).toBe(com1.id);
    });

    it('sin ocupación activa devuelve array vacío', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .get('/api/v1/me/communities')
        .set('Authorization', `Bearer ${vecino.token}`);

      expect(res.status).toBe(200);
      expect(res.body.communities).toEqual([]);
    });
  });
});
