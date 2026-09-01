import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UserRole } from '../../users/user-role.enum.js';
import { currentUserFactory } from './current-user.decorator.js';

function contextWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('currentUserFactory', () => {
  it('extracts req.user from the execution context', () => {
    const user = { sub: 'user-1', email: 'a@b.com', role: UserRole.USER };

    const result = currentUserFactory(undefined, contextWithUser(user));

    expect(result).toBe(user);
  });
});
