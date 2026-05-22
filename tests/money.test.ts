import {
  eurosToCents,
  centsToEuros,
  formatEuros,
  distributeByCoefficient,
} from '../src/utils/money';

describe('money utilities', () => {
  describe('eurosToCents / centsToEuros', () => {
    it('convierte euros a céntimos redondeando al entero más cercano', () => {
      expect(eurosToCents(10)).toBe(1000);
      expect(eurosToCents(10.005)).toBe(1001);
      expect(eurosToCents(0.1 + 0.2)).toBe(30); // 0.30 a pesar del flotante
    });

    it('roundtrip cents → euros conserva el valor en céntimos', () => {
      expect(centsToEuros(eurosToCents(123.45))).toBe(123.45);
    });

    it('formatEuros devuelve dos decimales como string', () => {
      expect(formatEuros(1)).toBe('0.01');
      expect(formatEuros(1000)).toBe('10.00');
    });
  });

  describe('distributeByCoefficient', () => {
    it('devuelve [] si no hay shares', () => {
      expect(distributeByCoefficient(10000, [])).toEqual([]);
    });

    it('lanza si la suma de shares es 0 o negativa', () => {
      expect(() => distributeByCoefficient(10000, [0, 0])).toThrow();
    });

    it('reparte 100€ entre tres unidades iguales y la suma cuadra al céntimo', () => {
      const total = eurosToCents(100);
      const portions = distributeByCoefficient(total, [33.33, 33.33, 33.34]);
      expect(portions.reduce((a, b) => a + b, 0)).toBe(total);
      // El último absorbe el residual de redondeo
      expect(portions).toEqual([3333, 3333, 3334]);
    });

    it('arrastra el residual al último item para cuadrar exactamente', () => {
      // 1000€ entre tres unidades iguales, residual de 1 céntimo al último
      const total = eurosToCents(1000);
      const portions = distributeByCoefficient(total, [33.33, 33.33, 33.33]);
      expect(portions.reduce((a, b) => a + b, 0)).toBe(total);
      const last = portions[portions.length - 1];
      // Las dos primeras son iguales o muy próximas, la última suele diferir
      expect(last).toBeGreaterThanOrEqual(portions[0]);
    });

    it('respeta proporciones desiguales (50/30/20) sobre 1000€', () => {
      const total = eurosToCents(1000);
      const portions = distributeByCoefficient(total, [50, 30, 20]);
      expect(portions.reduce((a, b) => a + b, 0)).toBe(total);
      expect(portions[0]).toBe(50000);
      expect(portions[1]).toBe(30000);
      expect(portions[2]).toBe(20000);
    });

    it('soporta unidades con coeficiente 0 (no reciben nada)', () => {
      const total = eurosToCents(1000);
      const portions = distributeByCoefficient(total, [50, 50, 0]);
      expect(portions).toEqual([50000, 50000, 0]);
      expect(portions.reduce((a, b) => a + b, 0)).toBe(total);
    });

    it('soporta sumas de shares < 100 (cuando hay unidades excluidas externamente)', () => {
      // Solo 80% del coef total — el reparto sigue cuadrando con el total dado.
      const total = eurosToCents(500);
      const portions = distributeByCoefficient(total, [40, 40]);
      expect(portions.reduce((a, b) => a + b, 0)).toBe(total);
      expect(portions[0]).toBe(25000);
      expect(portions[1]).toBe(25000);
    });

    it('una sola unidad recibe el total entero', () => {
      const total = eurosToCents(777.77);
      const portions = distributeByCoefficient(total, [100]);
      expect(portions).toEqual([total]);
    });

    it('importes pequeños (1 céntimo) sin perder dinero', () => {
      const portions = distributeByCoefficient(1, [50, 50]);
      expect(portions.reduce((a, b) => a + b, 0)).toBe(1);
    });
  });
});
