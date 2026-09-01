import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../users/user-role.enum.js';
import { JwtStrategy } from './jwt.strategy.js';

function mockConfigService(secret: string | undefined): ConfigService {
  return {
    get: vi.fn().mockReturnValue(secret),
  } as unknown as ConfigService;
}

describe('JwtStrategy', () => {
  it('validate() maps a user-role payload to sub/role only, dropping email', () => {
    const strategy = new JwtStrategy(mockConfigService('test-secret'));

    const result = strategy.validate({
      sub: 'user-1',
      role: UserRole.USER,
      iat: 1000,
      exp: 2000,
    });

    expect(result).toEqual({
      sub: 'user-1',
      role: UserRole.USER,
    });
    expect(result).not.toHaveProperty('email');
  });

  it('validate() maps an admin-role payload, preserves the admin role, and drops email', () => {
    const strategy = new JwtStrategy(mockConfigService('test-secret'));

    const result = strategy.validate({
      sub: 'admin-1',
      role: UserRole.ADMIN,
      iat: 1000,
      exp: 2000,
    });

    expect(result).toEqual({
      sub: 'admin-1',
      role: UserRole.ADMIN,
    });
    expect(result).not.toHaveProperty('email');
  });
});
