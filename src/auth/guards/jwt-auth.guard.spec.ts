import { AuthGuard } from '@nestjs/passport';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard.js';

function mockContext(): ExecutionContext {
  return {
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

function mockReflector(isPublic: boolean | undefined): Reflector {
  return {
    getAllAndOverride: vi.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
}

describe('JwtAuthGuard', () => {
  let superCanActivateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    superCanActivateSpy = vi.spyOn(
      AuthGuard('jwt').prototype,
      'canActivate',
    );
  });

  it('bypasses passport authentication when the route is marked @Public()', () => {
    const guard = new JwtAuthGuard(mockReflector(true));

    const result = guard.canActivate(mockContext());

    expect(result).toBe(true);
    expect(superCanActivateSpy).not.toHaveBeenCalled();
  });

  it('delegates to the passport jwt strategy when the route is not public', () => {
    superCanActivateSpy.mockReturnValue(true);
    const guard = new JwtAuthGuard(mockReflector(false));
    const context = mockContext();

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(superCanActivateSpy).toHaveBeenCalledWith(context);
  });

  it('propagates a 401 from the passport jwt strategy for an invalid token', () => {
    superCanActivateSpy.mockImplementation(() => {
      throw new UnauthorizedException();
    });
    const guard = new JwtAuthGuard(mockReflector(undefined));

    expect(() => guard.canActivate(mockContext())).toThrow(
      UnauthorizedException,
    );
  });
});
