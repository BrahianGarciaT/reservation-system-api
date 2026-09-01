import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../types/jwt-payload.type.js';

export function currentUserFactory(
  _data: unknown,
  context: ExecutionContext,
): JwtPayload {
  const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
  return request.user;
}

export const CurrentUser = createParamDecorator(currentUserFactory);
