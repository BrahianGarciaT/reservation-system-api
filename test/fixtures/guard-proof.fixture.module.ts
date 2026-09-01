import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy.js';
import { GuardProofFixtureController } from './guard-proof.fixture.controller.js';

/**
 * Test-only module wiring the guard/strategy infrastructure together for
 * `guard-proof.e2e-spec.ts`. Never imported by src/app.module.ts — full
 * production AuthModule wiring (JwtModule, controllers, endpoints) ships in
 * a later change.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PassportModule],
  controllers: [GuardProofFixtureController],
  providers: [JwtStrategy, JwtAuthGuard, RolesGuard],
})
export class GuardProofFixtureModule {}
