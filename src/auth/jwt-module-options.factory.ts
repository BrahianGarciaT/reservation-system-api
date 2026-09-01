import type { ConfigService } from '@nestjs/config';
import type { JwtModuleOptions } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';

const DEFAULT_JWT_EXPIRES_IN = '1h';

export function createJwtModuleOptions(
  configService: ConfigService,
): JwtModuleOptions {
  const secret = configService.get<string>('JWT_SECRET');

  if (!secret) {
    throw new Error('JWT_SECRET must be set');
  }

  return {
    secret,
    signOptions: {
      expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ??
        DEFAULT_JWT_EXPIRES_IN) as SignOptions['expiresIn'],
    },
  };
}
