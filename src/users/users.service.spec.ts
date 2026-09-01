import * as bcrypt from 'bcrypt';
import type { Repository } from 'typeorm';
import { User } from './user.entity.js';
import { UserRole } from './user-role.enum.js';
import { UsersService } from './users.service.js';

function createMockRepository(): Repository<User> {
  return {
    create: vi.fn((entityLike: Partial<User>) => entityLike as User),
    save: vi.fn(async (entity: User) => entity),
    findOneBy: vi.fn(),
  } as unknown as Repository<User>;
}

describe('UsersService', () => {
  describe('create', () => {
    it('hashes the plaintext password with bcrypt before saving', async () => {
      const repository = createMockRepository();
      const service = new UsersService(repository);

      const user = await service.create({
        email: 'alice@example.com',
        password: 'plaintext-secret-1',
        role: UserRole.USER,
      });

      expect(user.passwordHash).not.toBe('plaintext-secret-1');
      expect(await bcrypt.compare('plaintext-secret-1', user.passwordHash)).toBe(
        true,
      );
    });

    it('normalizes the email by trimming and lowercasing before saving', async () => {
      const repository = createMockRepository();
      const service = new UsersService(repository);

      const user = await service.create({
        email: '  Bob@Example.COM  ',
        password: 'another-secret-2',
        role: UserRole.USER,
      });

      expect(user.email).toBe('bob@example.com');
    });

    it('produces a distinct bcrypt hash for a different password', async () => {
      const repository = createMockRepository();
      const service = new UsersService(repository);

      const user = await service.create({
        email: 'carol@example.com',
        password: 'yet-another-secret-3',
        role: UserRole.USER,
      });

      expect(user.passwordHash).not.toBe('yet-another-secret-3');
      expect(
        await bcrypt.compare('yet-another-secret-3', user.passwordHash),
      ).toBe(true);
      expect(await bcrypt.compare('wrong-password', user.passwordHash)).toBe(
        false,
      );
    });

    it('leaves an already-normalized email unchanged', async () => {
      const repository = createMockRepository();
      const service = new UsersService(repository);

      const user = await service.create({
        email: 'dave@example.com',
        password: 'fourth-secret-4',
        role: UserRole.ADMIN,
      });

      expect(user.email).toBe('dave@example.com');
      expect(user.role).toBe(UserRole.ADMIN);
    });
  });

  describe('findByEmail', () => {
    it('queries the repository using the trimmed, lowercased email', async () => {
      const repository = createMockRepository();
      const storedUser = {
        id: 'user-1',
        email: 'erin@example.com',
        passwordHash: 'hash',
        role: UserRole.USER,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      } as User;
      (repository.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue(
        storedUser,
      );
      const service = new UsersService(repository);

      const result = await service.findByEmail('  Erin@Example.COM  ');

      expect(repository.findOneBy).toHaveBeenCalledWith({
        email: 'erin@example.com',
      });
      expect(result).toBe(storedUser);
    });

    it('returns null when no user matches the normalized email', async () => {
      const repository = createMockRepository();
      (repository.findOneBy as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );
      const service = new UsersService(repository);

      const result = await service.findByEmail('nobody@example.com');

      expect(result).toBeNull();
    });
  });

  describe('toResponse', () => {
    it('omits passwordHash and includes id, email, role, createdAt', () => {
      const repository = createMockRepository();
      const service = new UsersService(repository);
      const createdAt = new Date('2026-02-15T10:00:00.000Z');
      const user = {
        id: 'user-42',
        email: 'frank@example.com',
        passwordHash: '$2b$10$super-secret-hash-value',
        role: UserRole.USER,
        createdAt,
        updatedAt: createdAt,
      } as User;

      const response = service.toResponse(user);

      expect(response).toEqual({
        id: 'user-42',
        email: 'frank@example.com',
        role: UserRole.USER,
        createdAt,
      });
      expect(response).not.toHaveProperty('passwordHash');
    });

    it('reflects the admin role for an admin user', () => {
      const repository = createMockRepository();
      const service = new UsersService(repository);
      const user = {
        id: 'user-99',
        email: 'grace@example.com',
        passwordHash: '$2b$10$another-hash',
        role: UserRole.ADMIN,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      } as User;

      const response = service.toResponse(user);

      expect(response.role).toBe(UserRole.ADMIN);
      expect(response).not.toHaveProperty('passwordHash');
    });
  });
});
