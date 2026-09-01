import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../users/user-role.enum.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { JwtPayload } from '../types/jwt-payload.type.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      UserRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return false;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload }>();

    return !!user && requiredRoles.includes(user.role);
  }
}
