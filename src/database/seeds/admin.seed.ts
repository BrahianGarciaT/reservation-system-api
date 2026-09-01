import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module.js';
import { UsersService } from '../../users/users.service.js';
import { seedAdmin } from './seed-admin.logic.js';

const logger = new Logger('SeedAdmin');

async function run(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must both be set',
    );
  }

  const appContext = await NestFactory.createApplicationContext(AppModule);

  try {
    const usersService = appContext.get(UsersService);
    const result = await seedAdmin(usersService, email, password);

    if (result.created) {
      logger.log(`Admin user created for ${email}`);
    } else {
      logger.log(`Admin user already exists for ${email} — nothing to do`);
    }
  } finally {
    await appContext.close();
  }
}

await run();
