import { UserRole } from '../../users/user-role.enum.js';
import type { UsersService } from '../../users/users.service.js';

export interface SeedAdminResult {
  created: boolean;
}

export async function seedAdmin(
  usersService: UsersService,
  email: string,
  password: string,
): Promise<SeedAdminResult> {
  const existing = await usersService.findByEmail(email);

  if (existing) {
    return { created: false };
  }

  await usersService.create({ email, password, role: UserRole.ADMIN });
  return { created: true };
}
