import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../src/auth/decorators/current-user.decorator.js';
import { Public } from '../../src/auth/decorators/public.decorator.js';
import { Roles } from '../../src/auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';
import type { JwtPayload } from '../../src/auth/types/jwt-payload.type.js';
import { UserRole } from '../../src/users/user-role.enum.js';

/**
 * Test-only fixture controller. Exists solely to exercise JwtAuthGuard and
 * RolesGuard end-to-end (per design SCOPE AMENDMENT), since no production
 * protected route ships in this change. Never imported by src/app.module.ts.
 */
@Controller('fixtures')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GuardProofFixtureController {
  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true };
  }

  @Roles(UserRole.ADMIN, UserRole.USER)
  @Get('protected')
  protectedRoute(@CurrentUser() user: JwtPayload) {
    return { ok: true, sub: user.sub };
  }

  @Roles(UserRole.ADMIN)
  @Get('admin-only')
  adminOnlyRoute(@CurrentUser() user: JwtPayload) {
    return { ok: true, sub: user.sub };
  }
}
