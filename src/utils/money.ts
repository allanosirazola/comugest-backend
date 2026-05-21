/**
 * Aritmética monetaria en céntimos para evitar errores de coma flotante.
 * Internamente trabajamos en céntimos (enteros) y convertimos al final.
 */

export type Cents = number;

export function eurosToCents(euros: number): Cents {
  return Math.round(euros * 100);
}

export function centsToEuros(cents: Cents): number {
  return cents / 100;
}

export function formatEuros(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

/**
 * Reparte un importe total entre N "shares" (porcentajes).
 *
 * - Cada share es un porcentaje del 0 al 100.
 * - La suma de shares puede ser ≤ 100 (lo habitual es exactamente 100, pero a
 *   veces hay unidades con coef 0 — garajes/trasteros excluidos de derramas).
 * - El residual de redondeo se acumula y se suma al último item para que la
 *   suma final sea exactamente igual al total (al céntimo).
 *
 * Devuelve un array del mismo tamaño que shares, en céntimos.
 *
 * Ejemplo:
 *   distributeByCoefficient(eurosToCents(1000), [33.33, 33.33, 33.34])
 *   => [33330, 33330, 33340]  (suma exacta = 100000)
 */
export function distributeByCoefficient(totalCents: Cents, shares: number[]): Cents[] {
  if (shares.length === 0) return [];

  const sumShares = shares.reduce((acc, s) => acc + s, 0);
  if (sumShares <= 0) {
    throw new Error('La suma de coeficientes debe ser mayor que 0');
  }

  // Calculamos cada porción y vamos acumulando lo asignado para arrastrar
  // el residual al último item.
  const result: Cents[] = new Array(shares.length).fill(0);
  let assignedSoFar = 0;

  for (let i = 0; i < shares.length - 1; i++) {
    const portion = Math.round((totalCents * shares[i]) / sumShares);
    result[i] = portion;
    assignedSoFar += portion;
  }

  // El último item se queda con el resto exacto
  result[shares.length - 1] = totalCents - assignedSoFar;

  return result;
}
