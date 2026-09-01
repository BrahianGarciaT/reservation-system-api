import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { User } from './user.entity.js';
import { UserRole } from './user-role.enum.js';
import { UsersService } from './users.service.js';

// Integration test against the real docker Postgres instance (see
// docker-compose.yml). Proves the PG unique-violation (23505) on the
// `email` column is mapped to a domain-level ConflictException, which
// cannot be verified with a mocked repository.
describe('UsersService (integration)', () => {
  let dataSource: DataSource;
  let repository: Repository<User>;
  let service: UsersService;

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
    service = new UsersService(repository);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  afterEach(async () => {
    await repository.query('TRUNCATE TABLE "users"');
  });

  it('maps a duplicate email unique-violation to ConflictException', async () => {
    await service.create({
      email: 'duplicate@example.com',
      password: 'first-password-1',
      role: UserRole.USER,
    });

    await expect(
      service.create({
        email: 'Duplicate@Example.com',
        password: 'second-password-2',
        role: UserRole.USER,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const rows = await repository.find({
      where: { email: 'duplicate@example.com' },
    });
    expect(rows).toHaveLength(1);
  });

  it('allows two different emails to be created without conflict', async () => {
    await service.create({
      email: 'first@example.com',
      password: 'password-one-1',
      role: UserRole.USER,
    });
    const second = await service.create({
      email: 'second@example.com',
      password: 'password-two-2',
      role: UserRole.USER,
    });

    expect(second.email).toBe('second@example.com');
    const rows = await repository.find();
    expect(rows).toHaveLength(2);
  });
});
