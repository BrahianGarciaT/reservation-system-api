import { describe, expect, it } from 'vitest';
import { UserRole } from '../../users/user-role.enum.js';
import { ROLES_KEY, Roles } from './roles.decorator.js';

describe('Roles decorator', () => {
  it('attaches the given roles list as metadata on the decorated handler', () => {
    class Fixture {
      @Roles(UserRole.ADMIN)
      handler() {}
    }

    const metadata = Reflect.getMetadata(ROLES_KEY, Fixture.prototype.handler);

    expect(metadata).toEqual([UserRole.ADMIN]);
  });

  it('accepts multiple roles and preserves the exact set', () => {
    class Fixture {
      @Roles(UserRole.ADMIN, UserRole.USER)
      handler() {}
    }

    const metadata = Reflect.getMetadata(ROLES_KEY, Fixture.prototype.handler);

    expect(metadata).toEqual([UserRole.ADMIN, UserRole.USER]);
  });
});
