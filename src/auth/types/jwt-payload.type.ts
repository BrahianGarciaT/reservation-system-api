import type { UserRole } from '../../users/user-role.enum.js';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}
