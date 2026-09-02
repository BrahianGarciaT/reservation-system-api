import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/types/jwt-payload.type.js';
import { ResourceSchedule } from '../resources/resource-schedule.entity.js';
import { Resource } from '../resources/resource.entity.js';
import { UserRole } from '../users/user-role.enum.js';
import { User } from '../users/user.entity.js';
import { ReservationStatus } from './reservation-status.enum.js';
import { Reservation } from './reservation.entity.js';
import { ReservationsService } from './reservations.service.js';

// Integration tests against the real docker Postgres instance. Proves what a
// mocked repo/DataSource cannot: the *partial* `EXCLUDE USING gist` non-
// overlap constraint (and its `WHERE (status <> 'cancelled')` predicate),
// the reschedule UPDATE's self-non-conflict semantics, and FK cascade.
describe('ReservationsService (integration)', () => {
  let dataSource: DataSource;
  let reservationRepository: Repository<Reservation>;
  let resourceRepository: Repository<Resource>;
  let scheduleRepository: Repository<ResourceSchedule>;
  let userRepository: Repository<User>;
  let service: ReservationsService;

  let owner: User;
  let ownerPayload: JwtPayload;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [Reservation, Resource, ResourceSchedule, User],
      synchronize: false,
    });
    await dataSource.initialize();
    reservationRepository = dataSource.getRepository(Reservation);
    resourceRepository = dataSource.getRepository(Resource);
    scheduleRepository = dataSource.getRepository(ResourceSchedule);
    userRepository = dataSource.getRepository(User);
    service = new ReservationsService(
      reservationRepository,
      resourceRepository,
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  afterEach(async () => {
    await reservationRepository.query(
      'TRUNCATE TABLE "reservations", "resource_schedules", "resources", "users" CASCADE',
    );
  });

  beforeEach(async () => {
    owner = await userRepository.save({
      email: `owner-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: 'hash',
      role: UserRole.USER,
    });
    ownerPayload = { sub: owner.id, role: UserRole.USER };
  });

  async function createMondayResource(
    overrides: Partial<Resource> = {},
  ): Promise<Resource> {
    const resource = await resourceRepository.save({
      name: 'Room A',
      capacity: 4,
      isActive: true,
      minBookingMinutes: 30,
      maxBookingMinutes: 180,
      notes: null,
      amenities: [],
      ...overrides,
    });
    await scheduleRepository.save({
      resourceId: resource.id,
      dayOfWeek: 1, // Monday — 2027-01-04 is a Monday
      openTime: '09:00',
      closeTime: '18:00',
    });
    return resource;
  }

  it('post-migration schema check: reservations table, enum, and EXC_reservations_no_overlap all exist', async () => {
    const tables = await reservationRepository.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'reservations'`,
    );
    const types = await reservationRepository.query(
      `SELECT typname FROM pg_type WHERE typname = 'reservations_status_enum'`,
    );
    const constraints = await reservationRepository.query(
      `SELECT conname FROM pg_constraint WHERE conname = 'EXC_reservations_no_overlap'`,
    );

    expect(tables).toHaveLength(1);
    expect(types).toHaveLength(1);
    expect(constraints).toHaveLength(1);
  });

  describe('non-negotiable #1 — partial EXCLUDE proof', () => {
    it('rejects two overlapping non-cancelled reservations on the same resource with 23P01/409', async () => {
      const resource = await createMondayResource();

      await service.create(
        {
          resourceId: resource.id,
          startsAt: '2027-01-04T09:00:00.000Z',
          endsAt: '2027-01-04T10:00:00.000Z',
        },
        ownerPayload,
      );

      await expect(
        service.create(
          {
            resourceId: resource.id,
            startsAt: '2027-01-04T09:30:00.000Z',
            endsAt: '2027-01-04T10:30:00.000Z',
          },
          ownerPayload,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      const rows = await reservationRepository.find({
        where: { resourceId: resource.id },
      });
      expect(rows).toHaveLength(1);
    });

    it('does NOT block booking an identical range once the conflicting reservation is cancelled', async () => {
      const resource = await createMondayResource();

      const first = await service.create(
        {
          resourceId: resource.id,
          startsAt: '2027-01-04T09:00:00.000Z',
          endsAt: '2027-01-04T10:00:00.000Z',
        },
        ownerPayload,
      );

      await service.cancel(first.id, ownerPayload);

      const second = await service.create(
        {
          resourceId: resource.id,
          startsAt: '2027-01-04T09:00:00.000Z',
          endsAt: '2027-01-04T10:00:00.000Z',
        },
        ownerPayload,
      );

      expect(second.status).toBe(ReservationStatus.CONFIRMED);
      const rows = await reservationRepository.find({
        where: { resourceId: resource.id },
      });
      expect(rows).toHaveLength(2);
    });
  });

  it('accepts back-to-back [) bookings on the same resource (10-11, 11-12)', async () => {
    const resource = await createMondayResource();

    await service.create(
      {
        resourceId: resource.id,
        startsAt: '2027-01-04T10:00:00.000Z',
        endsAt: '2027-01-04T11:00:00.000Z',
      },
      ownerPayload,
    );

    const second = await service.create(
      {
        resourceId: resource.id,
        startsAt: '2027-01-04T11:00:00.000Z',
        endsAt: '2027-01-04T12:00:00.000Z',
      },
      ownerPayload,
    );

    expect(second).toBeDefined();
    const rows = await reservationRepository.find({
      where: { resourceId: resource.id },
    });
    expect(rows).toHaveLength(2);
  });

  it('allows two cancelled overlapping reservations to coexist on the same resource', async () => {
    const resource = await createMondayResource();

    const first = await service.create(
      {
        resourceId: resource.id,
        startsAt: '2027-01-04T09:00:00.000Z',
        endsAt: '2027-01-04T10:00:00.000Z',
      },
      ownerPayload,
    );
    await service.cancel(first.id, ownerPayload);

    // Directly insert a second overlapping row already cancelled — bypasses
    // create()'s active-conflict check entirely, proving the DB constraint
    // itself (not just the service) never blocks two cancelled rows.
    await reservationRepository.save({
      resourceId: resource.id,
      userId: owner.id,
      startsAt: new Date('2027-01-04T09:30:00.000Z'),
      endsAt: new Date('2027-01-04T10:30:00.000Z'),
      status: ReservationStatus.CANCELLED,
    });

    const rows = await reservationRepository.find({
      where: { resourceId: resource.id },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === ReservationStatus.CANCELLED)).toBe(
      true,
    );
  });

  describe('non-negotiable #2 — atomic reschedule proof', () => {
    it('reschedules to an overlapping-with-itself-but-shifted range without self-conflict', async () => {
      const resource = await createMondayResource();
      const created = await service.create(
        {
          resourceId: resource.id,
          startsAt: '2027-01-04T10:00:00.000Z',
          endsAt: '2027-01-04T11:00:00.000Z',
        },
        ownerPayload,
      );

      const rescheduled = await service.reschedule(
        created.id,
        {
          startsAt: '2027-01-04T10:30:00.000Z',
          endsAt: '2027-01-04T11:30:00.000Z',
        },
        ownerPayload,
      );

      expect(rescheduled.startsAt.toISOString()).toBe(
        '2027-01-04T10:30:00.000Z',
      );
      expect(rescheduled.endsAt.toISOString()).toBe('2027-01-04T11:30:00.000Z');
    });

    it('rejects a reschedule that conflicts with a DIFFERENT reservation, leaving the original row unchanged', async () => {
      const resource = await createMondayResource();
      const x = await service.create(
        {
          resourceId: resource.id,
          startsAt: '2027-01-04T09:00:00.000Z',
          endsAt: '2027-01-04T10:00:00.000Z',
        },
        ownerPayload,
      );
      await service.create(
        {
          resourceId: resource.id,
          startsAt: '2027-01-04T11:00:00.000Z',
          endsAt: '2027-01-04T12:00:00.000Z',
        },
        ownerPayload,
      );

      await expect(
        service.reschedule(
          x.id,
          {
            startsAt: '2027-01-04T11:30:00.000Z',
            endsAt: '2027-01-04T12:30:00.000Z',
          },
          ownerPayload,
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      const stillThere = await reservationRepository.findOne({
        where: { id: x.id },
      });
      expect(stillThere?.startsAt.toISOString()).toBe('2027-01-04T09:00:00.000Z');
      expect(stillThere?.endsAt.toISOString()).toBe('2027-01-04T10:00:00.000Z');
    });
  });

  describe('FK cascade', () => {
    it('deleting the resource cascades to its reservations', async () => {
      const resource = await createMondayResource();
      const created = await service.create(
        {
          resourceId: resource.id,
          startsAt: '2027-01-04T09:00:00.000Z',
          endsAt: '2027-01-04T10:00:00.000Z',
        },
        ownerPayload,
      );

      await resourceRepository.delete(resource.id);

      const remaining = await reservationRepository.findOne({
        where: { id: created.id },
      });
      expect(remaining).toBeNull();
    });

    it('deleting the user cascades to their reservations', async () => {
      const resource = await createMondayResource();
      const created = await service.create(
        {
          resourceId: resource.id,
          startsAt: '2027-01-04T09:00:00.000Z',
          endsAt: '2027-01-04T10:00:00.000Z',
        },
        ownerPayload,
      );

      await userRepository.delete(owner.id);

      const remaining = await reservationRepository.findOne({
        where: { id: created.id },
      });
      expect(remaining).toBeNull();
    });
  });
});
