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
  it('validate() maps a user-role payload to sub/email/role', () => {
    const strategy = new JwtStrategy(mockConfigService('test-secret'));

    const result = strategy.validate({
      sub: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
      iat: 1000,
      exp: 2000,
    });

    expect(result).toEqual({
      sub: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
    });
  });

  it('validate() maps an admin-role payload and preserves the admin role', () => {
    const strategy = new JwtStrategy(mockConfigService('test-secret'));

    const result = strategy.validate({
      sub: 'admin-1',
      email: 'admin@b.com',
      role: UserRole.ADMIN,
      iat: 1000,
      exp: 2000,
    });

    expect(result).toEqual({
      sub: 'admin-1',
      email: 'admin@b.com',
      role: UserRole.ADMIN,
    });
  });
});
