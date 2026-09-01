import type { ConfigService } from '@nestjs/config';
import { createJwtModuleOptions } from './jwt-module-options.factory.js';

function createMockConfigService(
  values: Record<string, string | undefined>,
): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('createJwtModuleOptions', () => {
  it('throws when JWT_SECRET is not set', () => {
    const configService = createMockConfigService({ JWT_SECRET: undefined });

    expect(() => createJwtModuleOptions(configService)).toThrow(
      'JWT_SECRET must be set',
    );
  });

  it('returns the configured secret and expiry when both are set', () => {
    const configService = createMockConfigService({
      JWT_SECRET: 'my-secret',
      JWT_EXPIRES_IN: '2h',
    });

    const options = createJwtModuleOptions(configService);

    expect(options).toEqual({
      secret: 'my-secret',
      signOptions: { expiresIn: '2h' },
    });
  });

  it('defaults expiry to 1h when JWT_EXPIRES_IN is not set', () => {
    const configService = createMockConfigService({
      JWT_SECRET: 'another-secret',
      JWT_EXPIRES_IN: undefined,
    });

    const options = createJwtModuleOptions(configService);

    expect(options).toEqual({
      secret: 'another-secret',
      signOptions: { expiresIn: '1h' },
    });
  });
});
