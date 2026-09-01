import { UserRole } from '../../users/user-role.enum.js';
import type { User } from '../../users/user.entity.js';
import type { UsersService } from '../../users/users.service.js';
import { seedAdmin } from './seed-admin.logic.js';

function createMockUsersService(): UsersService {
  return {
    create: vi.fn(),
    findByEmail: vi.fn(),
  } as unknown as UsersService;
}

describe('seedAdmin', () => {
  it('creates an admin user with role: admin when none exists yet', async () => {
    const usersService = createMockUsersService();
    (usersService.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
    (usersService.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    } as User);

    const result = await seedAdmin(
      usersService,
      'admin@example.com',
      'adminSecret1',
    );

    expect(usersService.create).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'adminSecret1',
      role: UserRole.ADMIN,
    });
    expect(result).toEqual({ created: true });
  });

  it('skips creation and reports created: false when the admin already exists', async () => {
    const usersService = createMockUsersService();
    (usersService.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    } as User);

    const result = await seedAdmin(
      usersService,
      'admin@example.com',
      'adminSecret1',
    );

    expect(usersService.create).not.toHaveBeenCalled();
    expect(result).toEqual({ created: false });
  });
});
