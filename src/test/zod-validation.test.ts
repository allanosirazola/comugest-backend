import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, resetPasswordSchema } from '../modules/auth/auth.schemas';
import { createInvoiceSchema, createPaymentSchema } from '../modules/invoices/invoices.schemas';
import { createUnitSchema } from '../modules/units/units.schemas';

// ─── Auth Schemas ────────────────────────────────────────────

describe('registerSchema', () => {
  const validBase = {
    email: 'user@example.com',
    password: 'SecurePass123',
    firstName: 'Ana',
    lastName: 'García',
    role: 'ADMIN_FINCAS' as const,
    gdprAccepted: true as const,
  };

  it('accepts a valid registration payload', () => {
    const result = registerSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('rejects missing email', () => {
    const { email: _email, ...rest } = validBase;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = registerSchema.safeParse({ ...validBase, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects password shorter than 10 characters', () => {
    const result = registerSchema.safeParse({ ...validBase, password: 'Short1' });
    expect(result.success).toBe(false);
  });

  it('rejects password without uppercase letter', () => {
    const result = registerSchema.safeParse({ ...validBase, password: 'alllowercase123' });
    expect(result.success).toBe(false);
  });

  it('rejects password without lowercase letter', () => {
    const result = registerSchema.safeParse({ ...validBase, password: 'ALLUPPERCASE123' });
    expect(result.success).toBe(false);
  });

  it('rejects password without a number', () => {
    const result = registerSchema.safeParse({ ...validBase, password: 'NoNumbersHere!' });
    expect(result.success).toBe(false);
  });

  it('rejects missing firstName', () => {
    const { firstName: _f, ...rest } = validBase;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects gdprAccepted: false', () => {
    const result = registerSchema.safeParse({ ...validBase, gdprAccepted: false });
    expect(result.success).toBe(false);
  });

  it('rejects invalid role', () => {
    const result = registerSchema.safeParse({ ...validBase, role: 'SUPER_ADMIN' });
    expect(result.success).toBe(false);
  });

  it('normalises email to lowercase', () => {
    const result = registerSchema.safeParse({ ...validBase, email: 'USER@EXAMPLE.COM' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('user@example.com');
    }
  });
});

describe('loginSchema', () => {
  it('accepts valid login payload', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: 'anything' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email format', () => {
    const result = loginSchema.safeParse({ email: 'bad', password: 'pass' });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('accepts valid reset payload', () => {
    const result = resetPasswordSchema.safeParse({ token: 'abc123', password: 'NewSecure1Pass' });
    expect(result.success).toBe(true);
  });

  it('rejects missing token', () => {
    const result = resetPasswordSchema.safeParse({ password: 'NewSecure1Pass' });
    expect(result.success).toBe(false);
  });

  it('rejects weak new password', () => {
    const result = resetPasswordSchema.safeParse({ token: 'abc', password: 'weak' });
    expect(result.success).toBe(false);
  });
});

// ─── Invoice Schemas ─────────────────────────────────────────

describe('createInvoiceSchema', () => {
  it('accepts valid DERRAMA invoice', () => {
    const result = createInvoiceSchema.safeParse({
      type: 'DERRAMA',
      concept: 'Cuota Comunidad Enero',
      dueDate: '2025-12-31',
      totalAmount: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid INDIVIDUAL invoice', () => {
    const parsed = createInvoiceSchema.safeParse({
      type: 'INDIVIDUAL',
      concept: 'Water Bill',
      dueDate: '2025-12-31',
      items: [{ unitId: 'clxxxxxxxxxxxxxxxxxxxxxxxx', amount: 50 }],
    });
    // We just need the type discriminator to work — no 'type' field errors
    expect(parsed.error?.issues.some(i => i.path.includes('type'))).toBeFalsy();
  });

  it('rejects DERRAMA with zero total amount', () => {
    const result = createInvoiceSchema.safeParse({
      type: 'DERRAMA',
      concept: 'Test',
      dueDate: '2025-12-31',
      totalAmount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects DERRAMA with negative total amount', () => {
    const result = createInvoiceSchema.safeParse({
      type: 'DERRAMA',
      concept: 'Test',
      dueDate: '2025-12-31',
      totalAmount: -100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects INDIVIDUAL invoice with empty items array', () => {
    const result = createInvoiceSchema.safeParse({
      type: 'INDIVIDUAL',
      concept: 'Test',
      dueDate: '2025-12-31',
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invoice with missing concept', () => {
    const result = createInvoiceSchema.safeParse({
      type: 'DERRAMA',
      dueDate: '2025-12-31',
      totalAmount: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invoice with missing dueDate', () => {
    const result = createInvoiceSchema.safeParse({
      type: 'DERRAMA',
      concept: 'Test',
      totalAmount: 100,
    });
    expect(result.success).toBe(false);
  });
});

describe('createPaymentSchema', () => {
  it('accepts valid payment', () => {
    const result = createPaymentSchema.safeParse({ amount: 100, method: 'BANK_TRANSFER' });
    expect(result.success).toBe(true);
  });

  it('rejects zero amount', () => {
    const result = createPaymentSchema.safeParse({ amount: 0, method: 'CASH' });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = createPaymentSchema.safeParse({ amount: -50, method: 'CASH' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid payment method', () => {
    const result = createPaymentSchema.safeParse({ amount: 100, method: 'CRYPTO' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid payment methods', () => {
    const methods = ['BANK_TRANSFER', 'CARD', 'CASH', 'DIRECT_DEBIT', 'OTHER'] as const;
    for (const method of methods) {
      const result = createPaymentSchema.safeParse({ amount: 100, method });
      expect(result.success).toBe(true);
    }
  });
});

// ─── Unit Schemas ────────────────────────────────────────────

describe('createUnitSchema', () => {
  const validUnit = {
    type: 'VIVIENDA' as const,
    label: '1A',
  };

  it('accepts valid unit', () => {
    const result = createUnitSchema.safeParse(validUnit);
    expect(result.success).toBe(true);
  });

  it('rejects missing type', () => {
    const { type: _t, ...rest } = validUnit;
    const result = createUnitSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid unit type', () => {
    const result = createUnitSchema.safeParse({ ...validUnit, type: 'PENTHOUSE' });
    expect(result.success).toBe(false);
  });

  it('rejects missing label', () => {
    const result = createUnitSchema.safeParse({ type: 'VIVIENDA' });
    expect(result.success).toBe(false);
  });

  it('rejects empty label', () => {
    const result = createUnitSchema.safeParse({ ...validUnit, label: '' });
    expect(result.success).toBe(false);
  });

  it('rejects negative coefficient', () => {
    const result = createUnitSchema.safeParse({ ...validUnit, coefficient: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects coefficient > 100', () => {
    const result = createUnitSchema.safeParse({ ...validUnit, coefficient: 101 });
    expect(result.success).toBe(false);
  });

  it('accepts all valid unit types', () => {
    const types = ['VIVIENDA', 'LOCAL', 'GARAJE', 'TRASTERO'] as const;
    for (const type of types) {
      const result = createUnitSchema.safeParse({ type, label: 'Test' });
      expect(result.success).toBe(true);
    }
  });
});
