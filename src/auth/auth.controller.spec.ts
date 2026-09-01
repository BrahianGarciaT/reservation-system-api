import type { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';

function createMockAuthService(): AuthService {
  return {
    register: vi.fn(),
    login: vi.fn(),
  } as unknown as AuthService;
}

describe('AuthController', () => {
  describe('register', () => {
    it('delegates to AuthService.register and returns its result', async () => {
      const authService = createMockAuthService();
      const expected = {
        accessToken: 'token-1',
        user: {
          id: 'user-1',
          email: 'alice@example.com',
          role: 'user',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      };
      (authService.register as ReturnType<typeof vi.fn>).mockResolvedValue(
        expected,
      );
      const controller = new AuthController(authService);
      const dto = { email: 'alice@example.com', password: 'secret123' };

      const result = await controller.register(dto);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });
  });

  describe('login', () => {
    it('delegates to AuthService.login and returns its result', async () => {
      const authService = createMockAuthService();
      const expected = { accessToken: 'token-2' };
      (authService.login as ReturnType<typeof vi.fn>).mockResolvedValue(
        expected,
      );
      const controller = new AuthController(authService);
      const dto = { email: 'bob@example.com', password: 'secret123' };

      const result = await controller.login(dto);

      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });
  });
});
