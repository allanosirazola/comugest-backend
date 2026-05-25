import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

// We test the authenticate and requireRole functions directly
// by importing them after the JWT mock is in place.
vi.mock('../utils/jwt', () => ({
  verifyAccessToken: vi.fn(),
  signAccessToken: vi.fn(() => 'mock-access-token'),
  signRefreshToken: vi.fn(() => 'mock-refresh-token'),
}));

import { authenticate, requireRole } from '../middleware/auth.middleware';
import { verifyAccessToken } from '../utils/jwt';

const mockVerifyAccessToken = vi.mocked(verifyAccessToken);

// Helper to create a minimal Express request/response/next triple
function makeReqRes(overrides: Partial<Request> = {}) {
  const req = { headers: {}, header: (name: string) => (req as any).headers[name.toLowerCase()], ...overrides } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws UnauthorizedError when Authorization header is missing', () => {
    const { req, res, next } = makeReqRes();
    expect(() => authenticate(req, res, next)).toThrow(UnauthorizedError);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedError when Authorization header does not start with Bearer', () => {
    const { req, res, next } = makeReqRes({
      header: () => 'Basic sometoken',
    } as any);
    (req as any).headers = { authorization: 'Basic sometoken' };
    expect(() => authenticate(req, res, next)).toThrow(UnauthorizedError);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when token is valid', () => {
    mockVerifyAccessToken.mockReturnValueOnce({ sub: 'user-1', role: 'ADMIN_FINCAS' });
    const { req, res, next } = makeReqRes();
    (req as any).headers = { authorization: 'Bearer valid.token.here' };
    (req as any).header = (name: string) => (req as any).headers[name.toLowerCase()];
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect((req as any).user).toEqual({ id: 'user-1', role: 'ADMIN_FINCAS' });
  });

  it('throws when verifyAccessToken throws (invalid token)', () => {
    mockVerifyAccessToken.mockImplementationOnce(() => { throw new UnauthorizedError('Token inválido'); });
    const { req, res, next } = makeReqRes();
    (req as any).headers = { authorization: 'Bearer bad.token' };
    (req as any).header = (name: string) => (req as any).headers[name.toLowerCase()];
    expect(() => authenticate(req, res, next)).toThrow(UnauthorizedError);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws UnauthorizedError when req.user is not set', () => {
    const { req, res, next } = makeReqRes();
    expect(() => requireRole('ADMIN_FINCAS')(req, res, next)).toThrow(UnauthorizedError);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError when user does not have the required role', () => {
    const { req, res, next } = makeReqRes();
    (req as any).user = { id: 'user-1', role: 'VECINO' };
    expect(() => requireRole('ADMIN_FINCAS')(req, res, next)).toThrow(ForbiddenError);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when user has the required role', () => {
    const { req, res, next } = makeReqRes();
    (req as any).user = { id: 'user-1', role: 'ADMIN_FINCAS' };
    requireRole('ADMIN_FINCAS')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next when user has one of multiple allowed roles', () => {
    const { req, res, next } = makeReqRes();
    (req as any).user = { id: 'user-1', role: 'SUPPORT' };
    requireRole('ADMIN_FINCAS', 'SUPPORT')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('throws ForbiddenError when user role is not in the allowed list', () => {
    const { req, res, next } = makeReqRes();
    (req as any).user = { id: 'user-1', role: 'VECINO' };
    expect(() => requireRole('ADMIN_FINCAS', 'SUPPORT')(req, res, next)).toThrow(ForbiddenError);
  });
});
