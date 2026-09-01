import 'dotenv/config';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ResourceSchedule } from './resource-schedule.entity.js';
import { Resource } from './resource.entity.js';
import { ResourcesService } from './resources.service.js';

// Integration tests against the real docker Postgres instance (see
// docker-compose.yml). Proves behavior that a mocked repo/DataSource cannot:
// the `EXCLUDE USING gist` non-overlap constraint, ON DELETE CASCADE, and
// transactional rollback of a rejected schedule replacement.
describe('ResourcesService (integration)', () => {
  let dataSource: DataSource;
  let resourceRepository: Repository<Resource>;
  let scheduleRepository: Repository<ResourceSchedule>;
  let service: ResourcesService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [Resource, ResourceSchedule],
      synchronize: false,
    });
    await dataSource.initialize();
    resourceRepository = dataSource.getRepository(Resource);
    scheduleRepository = dataSource.getRepository(ResourceSchedule);
    service = new ResourcesService(
      resourceRepository,
      scheduleRepository,
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  afterEach(async () => {
    await resourceRepository.query(
      'TRUNCATE TABLE "resource_schedules", "resources" CASCADE',
    );
  });

  it('post-migration schema check: resources, resource_schedules, and the timerange type all exist', async () => {
    const tables = await resourceRepository.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name IN ('resources', 'resource_schedules')`,
    );
    const types = await resourceRepository.query(
      `SELECT typname FROM pg_type WHERE typname = 'timerange'`,
    );

    expect(tables.map((t: { table_name: string }) => t.table_name).sort()).toEqual([
      'resource_schedules',
      'resources',
    ]);
    expect(types).toHaveLength(1);
  });

  it('rejects overlapping same-day windows for the same resource with a 23P01-derived ConflictException', async () => {
    await expect(
      service.create({
        name: 'Room A',
        capacity: 4,
        minBookingMinutes: 30,
        maxBookingMinutes: 60,
        schedules: [
          { dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' },
          { dayOfWeek: 1, openTime: '11:00', closeTime: '14:00' },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const rows = await resourceRepository.find();
    expect(rows).toHaveLength(0);
  });

  it('accepts back-to-back [) windows on the same day for the same resource', async () => {
    const resource = await service.create({
      name: 'Room C',
      capacity: 4,
      minBookingMinutes: 30,
      maxBookingMinutes: 60,
      schedules: [
        { dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' },
        { dayOfWeek: 1, openTime: '12:00', closeTime: '18:00' },
      ],
    });

    expect(resource.schedules).toHaveLength(2);
  });

  it('allows the identical time window on a different day of the same resource', async () => {
    const resource = await service.create({
      name: 'Room D',
      capacity: 4,
      minBookingMinutes: 30,
      maxBookingMinutes: 60,
      schedules: [
        { dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' },
        { dayOfWeek: 2, openTime: '09:00', closeTime: '12:00' },
      ],
    });

    expect(resource.schedules).toHaveLength(2);
  });

  it('allows the identical time window on the same day for a different resource', async () => {
    await service.create({
      name: 'Room E',
      capacity: 4,
      minBookingMinutes: 30,
      maxBookingMinutes: 60,
      schedules: [{ dayOfWeek: 3, openTime: '09:00', closeTime: '12:00' }],
    });

    const other = await service.create({
      name: 'Room F',
      capacity: 4,
      minBookingMinutes: 30,
      maxBookingMinutes: 60,
      schedules: [{ dayOfWeek: 3, openTime: '09:00', closeTime: '12:00' }],
    });

    expect(other.schedules).toHaveLength(1);
  });

  it('rolls back a rejected schedule replacement, leaving prior windows intact', async () => {
    const created = await service.create({
      name: 'Room G',
      capacity: 4,
      minBookingMinutes: 30,
      maxBookingMinutes: 60,
      schedules: [{ dayOfWeek: 4, openTime: '09:00', closeTime: '12:00' }],
    });

    await expect(
      service.update(created.id, {
        schedules: [
          { dayOfWeek: 4, openTime: '09:00', closeTime: '11:00' },
          { dayOfWeek: 4, openTime: '10:00', closeTime: '13:00' },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const stillThere = await service.findOne(created.id);
    expect(stillThere.schedules).toHaveLength(1);
    expect(stillThere.schedules[0].openTime).toBe('09:00:00');
    expect(stillThere.schedules[0].closeTime).toBe('12:00:00');
  });

  it('maps a raw 23514 (CHK_resource_schedules_window) CHECK violation to BadRequestException when it reaches the DB directly, bypassing DTO validation', async () => {
    // service.create() is called directly here — exactly like every other
    // test in this file — which never runs ScheduleWindowDto's class-
    // validator pipeline (that only happens behind the HTTP ValidationPipe
    // in the controller). This proves the DB-level CHK_resource_schedules_window
    // constraint (close_time > open_time) is still defended by the service
    // layer even for a caller that reaches ResourcesService without going
    // through the DTO-validated HTTP surface.
    await expect(
      service.create({
        name: 'Room I',
        capacity: 4,
        minBookingMinutes: 30,
        maxBookingMinutes: 60,
        schedules: [{ dayOfWeek: 6, openTime: '12:00', closeTime: '12:00' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const rows = await resourceRepository.find();
    expect(rows).toHaveLength(0);
  });

  it('ON DELETE CASCADE removes schedule rows when their resource row is deleted', async () => {
    const created = await service.create({
      name: 'Room H',
      capacity: 4,
      minBookingMinutes: 30,
      maxBookingMinutes: 60,
      schedules: [{ dayOfWeek: 5, openTime: '09:00', closeTime: '12:00' }],
    });

    await resourceRepository.delete(created.id);

    const remainingSchedules = await scheduleRepository.find({
      where: { resourceId: created.id },
    });
    expect(remainingSchedules).toHaveLength(0);
  });
});
