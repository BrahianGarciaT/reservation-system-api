import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module.js';
import { CreateUsersTable1788233211392 } from './database/migrations/1788233211392-CreateUsersTable.js';
import { HealthModule } from './health/health.module.js';
import { User } from './users/user.entity.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    UsersModule,
    AuthModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        // Explicit references (not a `dist/**/*.entity.js` glob) so entity
        // and migration metadata resolve identically whether this module
        // boots from compiled dist output or directly from TS source (as
        // Vitest e2e specs do via unplugin-swc) — a glob only ever matched
        // compiled .js files and silently found nothing under Vitest.
        entities: [User],
        migrations: [CreateUsersTable1788233211392],
        synchronize: false,
        migrationsRun: true,
      }),
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
