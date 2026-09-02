import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module.js';
import { CreateReservationsTable1788309117211 } from './database/migrations/1788309117211-CreateReservationsTable.js';
import { CreateResourcesTables1788256817633 } from './database/migrations/1788256817633-CreateResourcesTables.js';
import { CreateUsersTable1788233211392 } from './database/migrations/1788233211392-CreateUsersTable.js';
import { HealthModule } from './health/health.module.js';
import { Reservation } from './reservations/reservation.entity.js';
import { ReservationsModule } from './reservations/reservations.module.js';
import { ResourceSchedule } from './resources/resource-schedule.entity.js';
import { Resource } from './resources/resource.entity.js';
import { ResourcesModule } from './resources/resources.module.js';
import { User } from './users/user.entity.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    UsersModule,
    AuthModule,
    ResourcesModule,
    ReservationsModule,
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
        entities: [User, Resource, ResourceSchedule, Reservation],
        migrations: [
          CreateUsersTable1788233211392,
          CreateResourcesTables1788256817633,
          CreateReservationsTable1788309117211,
        ],
        synchronize: false,
        migrationsRun: true,
      }),
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
