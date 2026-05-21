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

describe('Expenses endpoints', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/communities/:communityId/expenses', () => {
    it('admin crea gasto (201)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/expenses`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          category: 'CLEANING',
          concept: 'Limpieza enero',
          amount: 150.5,
          expenseDate: new Date().toISOString(),
          supplier: 'LimpioYa SL',
        });

      expect(res.status).toBe(201);
      expect(res.body.expense.category).toBe('CLEANING');
      expect(Number(res.body.expense.amount)).toBeCloseTo(150.5, 2);
    });

    it('vecino no puede crear (403, requireRole)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/expenses`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({
          category: 'CLEANING',
          concept: 'X',
          amount: 10,
          expenseDate: new Date().toISOString(),
        });
      expect(res.status).toBe(403);
    });

    it('admin ajeno recibe 403', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/expenses`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({
          category: 'OTHER',
          concept: 'Hack',
          amount: 10,
          expenseDate: new Date().toISOString(),
        });
      expect(res.status).toBe(403);
    });

    it('rechaza categoría inválida (400)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/expenses`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          category: 'NOT_A_CATEGORY',
          concept: 'X',
          amount: 10,
          expenseDate: new Date().toISOString(),
        });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/communities/:communityId/expenses', () => {
    it('lista y devuelve resumen por categoría con porcentajes', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const seed = [
        { category: 'CLEANING' as const, amount: 100 },
        { category: 'CLEANING' as const, amount: 50 },
        { category: 'LIFT' as const, amount: 50 },
      ];
      for (const e of seed) {
        await prisma.expense.create({
          data: {
            communityId: community.id,
            category: e.category,
            concept: 'x',
            amount: e.amount,
            expenseDate: new Date(),
            recordedById: admin.id,
          },
        });
      }

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/expenses`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.expenses).toHaveLength(3);
      expect(res.body.summary.total).toBeCloseTo(200, 2);
      const cleaning = res.body.summary.byCategory.find((c: { category: string }) => c.category === 'CLEANING');
      expect(cleaning.total).toBeCloseTo(150, 2);
      expect(cleaning.count).toBe(2);
      expect(cleaning.percentage).toBeCloseTo(75, 1);
    });

    it('filtra por categoría', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      await prisma.expense.createMany({
        data: [
          { communityId: community.id, category: 'CLEANING', concept: 'a', amount: 10, expenseDate: new Date(), recordedById: admin.id },
          { communityId: community.id, category: 'LIFT', concept: 'b', amount: 20, expenseDate: new Date(), recordedById: admin.id },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/expenses?category=LIFT`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.expenses).toHaveLength(1);
      expect(res.body.expenses[0].category).toBe('LIFT');
    });

    it('filtra por rango de fechas', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const oldDate = new Date('2020-01-01');
      const newDate = new Date();
      await prisma.expense.createMany({
        data: [
          { communityId: community.id, category: 'OTHER', concept: 'viejo', amount: 1, expenseDate: oldDate, recordedById: admin.id },
          { communityId: community.id, category: 'OTHER', concept: 'nuevo', amount: 2, expenseDate: newDate, recordedById: admin.id },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/expenses?from=2024-01-01`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.expenses).toHaveLength(1);
      expect(res.body.expenses[0].concept).toBe('nuevo');
    });
  });

  describe('PATCH/DELETE /api/v1/expenses/:id', () => {
    async function makeExpense(adminId: string, communityId: string): Promise<string> {
      const e = await prisma.expense.create({
        data: {
          communityId,
          category: 'OTHER',
          concept: 'orig',
          amount: 30,
          expenseDate: new Date(),
          recordedById: adminId,
        },
      });
      return e.id;
    }

    it('actualiza concept y amount', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const id = await makeExpense(admin.id, community.id);

      const res = await request(app)
        .patch(`/api/v1/expenses/${id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ concept: 'actualizado', amount: 99.99 });

      expect(res.status).toBe(200);
      expect(res.body.expense.concept).toBe('actualizado');
      expect(Number(res.body.expense.amount)).toBeCloseTo(99.99, 2);
    });

    it('borra el gasto (204)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const id = await makeExpense(admin.id, community.id);

      const res = await request(app)
        .delete(`/api/v1/expenses/${id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(204);
      const still = await prisma.expense.findUnique({ where: { id } });
      expect(still).toBeNull();
    });

    it('404 si no existe', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const res = await request(app)
        .patch('/api/v1/expenses/ckxxxxxxxxxxxxxxxxxxxxxx')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ concept: 'x' });
      expect(res.status).toBe(404);
    });

    it('admin ajeno no puede actualizar (403)', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });
      const id = await makeExpense(owner.id, community.id);

      const res = await request(app)
        .patch(`/api/v1/expenses/${id}`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ concept: 'hack' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/me/expenses (transparencia vecino)', () => {
    it('vecino ve gastos solo de SU comunidad y sin recordedBy', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);
      await setOccupant(unit.id, vecino.id);
      await prisma.expense.create({
        data: {
          communityId: community.id,
          category: 'CLEANING',
          concept: 'visible',
          amount: 80,
          expenseDate: new Date(),
          recordedById: admin.id,
        },
      });

      const res = await request(app)
        .get(`/api/v1/me/expenses?communityId=${community.id}`)
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(200);
      expect(res.body.expenses).toHaveLength(1);
      // No expone recordedBy
      expect(res.body.expenses[0].recordedById).toBeUndefined();
      expect(res.body.summary.total).toBeCloseTo(80, 2);
    });

    it('vecino ajeno a la comunidad recibe 403', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const otherVecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });
      // otherVecino NO está en la comunidad

      const res = await request(app)
        .get(`/api/v1/me/expenses?communityId=${community.id}`)
        .set('Authorization', `Bearer ${otherVecino.token}`);
      expect(res.status).toBe(403);
    });

    it('400 si falta communityId', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .get('/api/v1/me/expenses')
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(400);
    });
  });
});
