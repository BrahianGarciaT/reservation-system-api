import 'dotenv/config';
import { DataSource, Repository } from 'typeorm';
import { User } from '../../users/user.entity.js';
import { UserRole } from '../../users/user-role.enum.js';
import { UsersService } from '../../users/users.service.js';
import { seedAdmin } from './seed-admin.logic.js';

// Integration test against the real docker Postgres instance, proving
// re-running the seed against a real UsersService + repository creates no
// duplicate row (relies on the same unique-email constraint UsersService
// already maps to ConflictException — but seedAdmin's findByEmail guard
// should make that path unreachable on a normal re-run).
describe('seedAdmin (integration)', () => {
  let dataSource: DataSource;
  let repository: Repository<User>;
  let usersService: UsersService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [User],
      synchronize: false,
    });
    await dataSource.initialize();
    repository = dataSource.getRepository(User);
    usersService = new UsersService(repository);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  afterEach(async () => {
    // CASCADE is required now that "reservations" holds a FK to "users":
    // a plain TRUNCATE fails once ANY table references "users", even when
    // no reservation rows exist yet (added by the reservations migration).
    await repository.query('TRUNCATE TABLE "users" CASCADE');
  });

  it('creates exactly one admin user the first time it runs', async () => {
    const result = await seedAdmin(
      usersService,
      'seed-admin@example.com',
      'seedAdminSecret1',
    );

    expect(result).toEqual({ created: true });
    const rows = await repository.find({
      where: { email: 'seed-admin@example.com' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe(UserRole.ADMIN);
  });

  it('creates no duplicate and exits without error on a second run', async () => {
    await seedAdmin(usersService, 'seed-admin@example.com', 'seedAdminSecret1');

    const secondResult = await seedAdmin(
      usersService,
      'seed-admin@example.com',
      'seedAdminSecret1',
    );

    expect(secondResult).toEqual({ created: false });
    const rows = await repository.find({
      where: { email: 'seed-admin@example.com' },
    });
    expect(rows).toHaveLength(1);
  });
});
