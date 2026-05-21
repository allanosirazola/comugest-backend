import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { cleanup, createCommunity, createUnit, createUser, setOccupant } from './helpers';

const app = createApp();

describe('Units endpoints', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('GET /api/v1/communities/:communityId/units', () => {
    it('lista unidades de la comunidad gestionada por el admin', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      await createUnit(community.id, { label: 'A' });
      await createUnit(community.id, { label: 'B' });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/units`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.units).toHaveLength(2);
    });

    it('un admin ajeno recibe 403', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/units`)
        .set('Authorization', `Bearer ${intruder.token}`);

      expect(res.status).toBe(403);
    });

    it('un vecino no tiene acceso (403, requireRole)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/units`)
        .set('Authorization', `Bearer ${vecino.token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/communities/:communityId/units', () => {
    it('crea unidad cuando suma de coeficientes no excede 100', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      await createUnit(community.id, { label: 'Existente', coefficient: 50 });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/units`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ type: 'VIVIENDA', label: 'Nueva', coefficient: 30 });

      expect(res.status).toBe(201);
      expect(res.body.unit.label).toBe('Nueva');
    });

    it('rechaza creación que excede 100 de coeficiente acumulado', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      await createUnit(community.id, { label: 'Existe', coefficient: 80 });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/units`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ type: 'VIVIENDA', label: 'Nueva', coefficient: 30 });

      expect(res.status).toBe(400);
    });

    it('rechaza etiqueta duplicada en la misma comunidad (conflict en BD → 500/Prisma)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      await createUnit(community.id, { label: 'DUP', coefficient: 10 });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/units`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ type: 'VIVIENDA', label: 'DUP', coefficient: 10 });

      // Prisma lanza P2002 (unique). El middleware lo trata como error genérico.
      expect([400, 409, 500]).toContain(res.status);
    });
  });

  describe('PATCH /api/v1/units/:id', () => {
    it('actualiza etiqueta y coeficiente', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id, { coefficient: 20 });

      const res = await request(app)
        .patch(`/api/v1/units/${unit.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ label: 'Renombrada', coefficient: 25 });

      expect(res.status).toBe(200);
      expect(res.body.unit.label).toBe('Renombrada');
      expect(Number(res.body.unit.coefficient)).toBeCloseTo(25, 5);
    });

    it('rechaza si el nuevo coeficiente lleva la suma > 100', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      await createUnit(community.id, { label: 'A', coefficient: 60 });
      const target = await createUnit(community.id, { label: 'B', coefficient: 30 });

      const res = await request(app)
        .patch(`/api/v1/units/${target.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ coefficient: 50 });

      expect(res.status).toBe(400);
    });

    it('admin ajeno no puede actualizar (403)', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });
      const unit = await createUnit(community.id);

      const res = await request(app)
        .patch(`/api/v1/units/${unit.id}`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ label: 'Hack' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/units/:id', () => {
    it('borra una unidad sin ocupantes (204)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);

      const res = await request(app)
        .delete(`/api/v1/units/${unit.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(204);
      const still = await prisma.unit.findUnique({ where: { id: unit.id } });
      expect(still).toBeNull();
    });

    it('rechaza con 409 si la unidad tiene ocupantes activos', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);
      await setOccupant(unit.id, vecino.id);

      const res = await request(app)
        .delete(`/api/v1/units/${unit.id}`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(409);
    });

    it('404 si la unidad no existe', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });

      const res = await request(app)
        .delete('/api/v1/units/ckxxxxxxxxxxxxxxxxxxxxxx')
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(404);
    });
  });
});
