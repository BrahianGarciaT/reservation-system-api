import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../users/user-role.enum.js';
import { RolesGuard } from './roles.guard.js';

function mockContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function mockReflector(requiredRoles: UserRole[] | undefined): Reflector {
  return {
    getAllAndOverride: vi.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('allows the request when the user role matches an allowed @Roles()', () => {
    const guard = new RolesGuard(mockReflector([UserRole.ADMIN]));
    const context = mockContext({ sub: '1', email: 'a@b.com', role: UserRole.ADMIN });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies with false when the user role does not match @Roles()', () => {
    const guard = new RolesGuard(mockReflector([UserRole.ADMIN]));
    const context = mockContext({ sub: '1', email: 'a@b.com', role: UserRole.USER });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('denies with false when no @Roles() metadata is present at all', () => {
    const guard = new RolesGuard(mockReflector(undefined));
    const context = mockContext({ sub: '1', email: 'a@b.com', role: UserRole.ADMIN });

    expect(guard.canActivate(context)).toBe(false);
  });
});
