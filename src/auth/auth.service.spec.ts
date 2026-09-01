import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../users/user-role.enum.js';
import type { User } from '../users/user.entity.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';

function createMockUsersService(): UsersService {
  return {
    create: vi.fn(),
    findByEmail: vi.fn(),
    toResponse: vi.fn((user: User) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    })),
  } as unknown as UsersService;
}

function createMockJwtService(): JwtService {
  return {
    sign: vi.fn(() => 'signed.jwt.token'),
  } as unknown as JwtService;
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    passwordHash: '',
    role: UserRole.USER,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as User;
}

describe('AuthService', () => {
  describe('register', () => {
    it('always creates the user with role: user, ignoring any client-supplied role', async () => {
      const usersService = createMockUsersService();
      const jwtService = createMockJwtService();
      const createdUser = buildUser({ id: 'user-2', email: 'bob@example.com' });
      (usersService.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        createdUser,
      );
      const service = new AuthService(usersService, jwtService);

      await service.register({
        email: 'bob@example.com',
        password: 'secret123',
      });

      expect(usersService.create).toHaveBeenCalledWith({
        email: 'bob@example.com',
        password: 'secret123',
        role: UserRole.USER,
      });
    });

    it('returns an accessToken and the response-shaped user, signed with sub/email/role', async () => {
      const usersService = createMockUsersService();
      const jwtService = createMockJwtService();
      const createdUser = buildUser({
        id: 'user-3',
        email: 'carol@example.com',
        role: UserRole.USER,
      });
      (usersService.create as ReturnType<typeof vi.fn>).mockResolvedValue(
        createdUser,
      );
      const service = new AuthService(usersService, jwtService);

      const result = await service.register({
        email: 'carol@example.com',
        password: 'secret123',
      });

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-3',
        email: 'carol@example.com',
        role: UserRole.USER,
      });
      expect(result).toEqual({
        accessToken: 'signed.jwt.token',
        user: {
          id: 'user-3',
          email: 'carol@example.com',
          role: UserRole.USER,
          createdAt: createdUser.createdAt,
        },
      });
    });
  });

  describe('login', () => {
    it('returns an accessToken when the email exists and the password matches', async () => {
      const usersService = createMockUsersService();
      const jwtService = createMockJwtService();
      const passwordHash = await bcrypt.hash('correct-password', 10);
      const existingUser = buildUser({
        id: 'user-4',
        email: 'dave@example.com',
        passwordHash,
        role: UserRole.ADMIN,
      });
      (usersService.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingUser,
      );
      const service = new AuthService(usersService, jwtService);

      const result = await service.login({
        email: 'dave@example.com',
        password: 'correct-password',
      });

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-4',
        email: 'dave@example.com',
        role: UserRole.ADMIN,
      });
      expect(result).toEqual({ accessToken: 'signed.jwt.token' });
    });

    it('throws a generic UnauthorizedException for an unknown email', async () => {
      const usersService = createMockUsersService();
      const jwtService = createMockJwtService();
      (usersService.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );
      const service = new AuthService(usersService, jwtService);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever1' }),
      ).rejects.toMatchObject({
        constructor: UnauthorizedException,
        message: 'Invalid credentials',
      });
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('throws the identical UnauthorizedException message for a wrong password', async () => {
      const usersService = createMockUsersService();
      const jwtService = createMockJwtService();
      const passwordHash = await bcrypt.hash('correct-password', 10);
      const existingUser = buildUser({
        id: 'user-5',
        email: 'erin@example.com',
        passwordHash,
      });
      (usersService.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingUser,
      );
      const service = new AuthService(usersService, jwtService);

      await expect(
        service.login({ email: 'erin@example.com', password: 'wrong-password' }),
      ).rejects.toMatchObject({
        constructor: UnauthorizedException,
        message: 'Invalid credentials',
      });
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });
});
