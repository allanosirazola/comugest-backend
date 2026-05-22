import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { cleanup, createCommunity, createUser } from './helpers';

const app = createApp();

describe('Budgets endpoints', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('PUT /api/v1/communities/:communityId/budgets/:year', () => {
    it('admin crea un presupuesto (200)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .put(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          year: 2025,
          lines: [
            { category: 'CLEANING', amount: 1200 },
            { category: 'LIFT', amount: 800 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.budget.lines).toHaveLength(2);
      const cleaningLine = res.body.budget.lines.find(
        (l: { category: string }) => l.category === 'CLEANING'
      );
      expect(Number(cleaningLine.amount)).toBeCloseTo(1200, 2);
    });

    it('upsert reemplaza las líneas existentes (idempotente)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      // Primera inserción
      await request(app)
        .put(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          year: 2025,
          lines: [
            { category: 'CLEANING', amount: 1000 },
            { category: 'LIFT', amount: 500 },
          ],
        });

      // Segunda inserción — reemplaza
      const res = await request(app)
        .put(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          year: 2025,
          lines: [{ category: 'INSURANCE', amount: 2000 }],
        });

      expect(res.status).toBe(200);
      expect(res.body.budget.lines).toHaveLength(1);
      expect(res.body.budget.lines[0].category).toBe('INSURANCE');

      // Verificar en BD que solo queda una línea
      const budget = await prisma.budget.findUnique({
        where: { communityId_year: { communityId: community.id, year: 2025 } },
        include: { lines: true },
      });
      expect(budget?.lines).toHaveLength(1);
    });

    it('vecino no puede crear presupuesto (403)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .put(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({
          year: 2025,
          lines: [{ category: 'CLEANING', amount: 100 }],
        });

      expect(res.status).toBe(403);
    });

    it('admin ajeno recibe 403', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });

      const res = await request(app)
        .put(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({
          year: 2025,
          lines: [{ category: 'CLEANING', amount: 100 }],
        });

      expect(res.status).toBe(403);
    });

    it('rechaza categoría inválida (400)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .put(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          year: 2025,
          lines: [{ category: 'NOT_A_CATEGORY', amount: 100 }],
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/communities/:communityId/budgets/:year', () => {
    it('devuelve resumen con importes reales vs presupuestados', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      // Crear presupuesto
      await request(app)
        .put(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          year: 2025,
          lines: [
            { category: 'CLEANING', amount: 1200 },
            { category: 'LIFT', amount: 800 },
          ],
        });

      // Crear gastos reales en 2025
      await prisma.expense.createMany({
        data: [
          {
            communityId: community.id,
            category: 'CLEANING',
            concept: 'Limpieza enero',
            amount: 300,
            expenseDate: new Date('2025-01-15'),
            recordedById: admin.id,
          },
          {
            communityId: community.id,
            category: 'CLEANING',
            concept: 'Limpieza febrero',
            amount: 250,
            expenseDate: new Date('2025-02-15'),
            recordedById: admin.id,
          },
          {
            communityId: community.id,
            category: 'LIFT',
            concept: 'Revisión ascensor',
            amount: 900,
            expenseDate: new Date('2025-03-01'),
            recordedById: admin.id,
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.year).toBe(2025);

      const cleaning = res.body.lines.find(
        (l: { category: string }) => l.category === 'CLEANING'
      );
      expect(cleaning.budgeted).toBeCloseTo(1200, 2);
      expect(cleaning.actual).toBeCloseTo(550, 2);
      expect(cleaning.variance).toBeCloseTo(650, 2);

      const lift = res.body.lines.find(
        (l: { category: string }) => l.category === 'LIFT'
      );
      expect(lift.budgeted).toBeCloseTo(800, 2);
      expect(lift.actual).toBeCloseTo(900, 2);
      expect(lift.variance).toBeCloseTo(-100, 2);
    });

    it('devuelve 404 cuando no existe presupuesto para el año', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/budgets/2099`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(404);
    });

    it('vecino no puede ver el presupuesto (403)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });

      await request(app)
        .put(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          year: 2025,
          lines: [{ category: 'CLEANING', amount: 500 }],
        });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${vecino.token}`);

      expect(res.status).toBe(403);
    });

    it('gastos de otros años no afectan al resumen', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      await request(app)
        .put(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          year: 2025,
          lines: [{ category: 'GARDENING', amount: 600 }],
        });

      // Gasto en 2024 (no debe contar para 2025)
      await prisma.expense.create({
        data: {
          communityId: community.id,
          category: 'GARDENING',
          concept: 'Jardinería 2024',
          amount: 400,
          expenseDate: new Date('2024-06-01'),
          recordedById: admin.id,
        },
      });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/budgets/2025`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const gardening = res.body.lines.find(
        (l: { category: string }) => l.category === 'GARDENING'
      );
      expect(gardening.actual).toBeCloseTo(0, 2);
      expect(gardening.variance).toBeCloseTo(600, 2);
    });
  });
});
