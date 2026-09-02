import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { UserRole } from '../src/users/user-role.enum.js';
import { User } from '../src/users/user.entity.js';

const JWT_SECRET = 'test-secret-for-reservations-e2e';

// `reservation.userId` is a real FK to `users(id)`, unlike the
// `resources.e2e-spec.ts` convention of signing a bare `sub: 'admin-1'` /
// `'user-1'` string — those are not UUIDs and have no `users` row, so a
// reservation created against them would violate the FK constraint. Real
// `User` rows must be seeded and their real UUIDs signed instead.
function signToken(role: UserRole, sub: string): string {
  return jwt.sign({ sub, role }, JWT_SECRET, { expiresIn: '1h' });
}

const ADMIN_EMAIL = 'reservations-e2e-admin@example.com';
const OWNER_EMAIL = 'reservations-e2e-owner@example.com';
const FOREIGN_EMAIL = 'reservations-e2e-foreign@example.com';

// A fixed far-future Monday, safely past any conceivable test-run "now".
const MONDAY = '2027-01-04'; // 2027-01-04T00:00:00Z is a Monday (UTC day 1)

describe('Reservations (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let ownerToken: string;
  let foreignToken: string;
  let adminUser: User;
  let ownerUser: User;
  let foreignUser: User;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    dataSource = moduleRef.get(DataSource);
    const userRepository = dataSource.getRepository(User);

    // Idempotent across reruns/crashed prior runs: clear any stale rows with
    // these emails before re-seeding.
    await userRepository.delete({
      email: In([ADMIN_EMAIL, OWNER_EMAIL, FOREIGN_EMAIL]),
    });
    adminUser = await userRepository.save({
      email: ADMIN_EMAIL,
      passwordHash: 'unused-hash',
      role: UserRole.ADMIN,
    });
    ownerUser = await userRepository.save({
      email: OWNER_EMAIL,
      passwordHash: 'unused-hash',
      role: UserRole.USER,
    });
    foreignUser = await userRepository.save({
      email: FOREIGN_EMAIL,
      passwordHash: 'unused-hash',
      role: UserRole.USER,
    });

    adminToken = signToken(UserRole.ADMIN, adminUser.id);
    ownerToken = signToken(UserRole.USER, ownerUser.id);
    foreignToken = signToken(UserRole.USER, foreignUser.id);
  });

  afterAll(async () => {
    await dataSource
      .getRepository(User)
      .delete([adminUser.id, ownerUser.id, foreignUser.id]);
    await app.close();
  });

  afterEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE "reservations", "resource_schedules", "resources" CASCADE',
    );
  });

  async function createMondayResource(
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/v1/resources')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Room A',
        capacity: 4,
        minBookingMinutes: 30,
        maxBookingMinutes: 120,
        schedules: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '18:00' }],
        ...overrides,
      });
    return response.body.id;
  }

  async function createTodayAllDayResource(): Promise<string> {
    const dayOfWeek = new Date().getUTCDay();
    const response = await request(app.getHttpServer())
      .post('/v1/resources')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Room All-Day',
        capacity: 4,
        minBookingMinutes: 30,
        maxBookingMinutes: 180,
        schedules: [{ dayOfWeek, openTime: '00:00', closeTime: '23:59' }],
      });
    return response.body.id;
  }

  function reservationPayload(overrides: Record<string, unknown> = {}) {
    return {
      startsAt: `${MONDAY}T09:00:00.000Z`,
      endsAt: `${MONDAY}T10:00:00.000Z`,
      ...overrides,
    };
  }

  describe('role matrix (401 anonymous / 200-201 authenticated) across all 5 routes', () => {
    it('POST /v1/reservations — 401 anonymous, 201 for owner and for admin', async () => {
      const resourceId = await createMondayResource();

      const anon = await request(app.getHttpServer())
        .post('/v1/reservations')
        .send(reservationPayload({ resourceId }));
      expect(anon.status).toBe(401);

      const asOwner = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));
      expect(asOwner.status).toBe(201);
      expect(asOwner.body.userId).toBe(ownerUser.id);

      const asAdmin = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(reservationPayload({ resourceId, startsAt: `${MONDAY}T10:00:00.000Z`, endsAt: `${MONDAY}T11:00:00.000Z` }));
      expect(asAdmin.status).toBe(201);
      expect(asAdmin.body.userId).toBe(adminUser.id);
    });

    it('GET /v1/reservations — 401 anonymous, 200 for owner and for admin', async () => {
      const anon = await request(app.getHttpServer()).get('/v1/reservations');
      expect(anon.status).toBe(401);

      const asOwner = await request(app.getHttpServer())
        .get('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(asOwner.status).toBe(200);

      const asAdmin = await request(app.getHttpServer())
        .get('/v1/reservations')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(asAdmin.status).toBe(200);
    });

    it('GET /v1/reservations/:id — 401 anonymous, 200 for owner and for admin', async () => {
      const resourceId = await createMondayResource();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));

      const anon = await request(app.getHttpServer()).get(
        `/v1/reservations/${created.body.id}`,
      );
      expect(anon.status).toBe(401);

      const asOwner = await request(app.getHttpServer())
        .get(`/v1/reservations/${created.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(asOwner.status).toBe(200);

      const asAdmin = await request(app.getHttpServer())
        .get(`/v1/reservations/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(asAdmin.status).toBe(200);
    });

    it('PATCH /v1/reservations/:id/cancel — 401 anonymous, 200 for owner and for admin', async () => {
      const resourceId = await createMondayResource();
      const first = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));
      const second = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T11:00:00.000Z`,
            endsAt: `${MONDAY}T12:00:00.000Z`,
          }),
        );

      const anon = await request(app.getHttpServer()).patch(
        `/v1/reservations/${first.body.id}/cancel`,
      );
      expect(anon.status).toBe(401);

      const asOwner = await request(app.getHttpServer())
        .patch(`/v1/reservations/${first.body.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(asOwner.status).toBe(200);

      const asAdmin = await request(app.getHttpServer())
        .patch(`/v1/reservations/${second.body.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(asAdmin.status).toBe(200);
    });

    it('PATCH /v1/reservations/:id/reschedule — 401 anonymous, 200 for owner and for admin', async () => {
      const resourceId = await createMondayResource();
      const first = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));
      const second = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T11:00:00.000Z`,
            endsAt: `${MONDAY}T12:00:00.000Z`,
          }),
        );

      const anon = await request(app.getHttpServer())
        .patch(`/v1/reservations/${first.body.id}/reschedule`)
        .send({ startsAt: `${MONDAY}T13:00:00.000Z`, endsAt: `${MONDAY}T14:00:00.000Z` });
      expect(anon.status).toBe(401);

      const asOwner = await request(app.getHttpServer())
        .patch(`/v1/reservations/${first.body.id}/reschedule`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ startsAt: `${MONDAY}T13:00:00.000Z`, endsAt: `${MONDAY}T14:00:00.000Z` });
      expect(asOwner.status).toBe(200);

      const asAdmin = await request(app.getHttpServer())
        .patch(`/v1/reservations/${second.body.id}/reschedule`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ startsAt: `${MONDAY}T15:00:00.000Z`, endsAt: `${MONDAY}T16:00:00.000Z` });
      expect(asAdmin.status).toBe(200);
    });
  });

  describe('POST /v1/reservations — create happy path + every assertBookable 400 branch', () => {
    it('creates the reservation for the happy path', async () => {
      const resourceId = await createMondayResource();

      const response = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('confirmed');
      expect(response.body.resourceId).toBe(resourceId);
    });

    it('rejects booking an inactive resource with 400', async () => {
      const resourceId = await createMondayResource();
      await request(app.getHttpServer())
        .patch(`/v1/resources/${resourceId}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      const response = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));

      expect(response.status).toBe(400);
    });

    it('rejects a startsAt in the past with 400', async () => {
      const resourceId = await createMondayResource();

      const response = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: '2020-01-06T09:00:00.000Z',
            endsAt: '2020-01-06T10:00:00.000Z',
          }),
        );

      expect(response.status).toBe(400);
    });

    it('rejects endsAt <= startsAt with 400', async () => {
      const resourceId = await createMondayResource();

      const response = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T09:00:00.000Z`,
            endsAt: `${MONDAY}T09:00:00.000Z`,
          }),
        );

      expect(response.status).toBe(400);
    });

    it('rejects a range crossing midnight (UTC) with 400', async () => {
      const resourceId = await createMondayResource();

      const response = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T23:00:00.000Z`,
            endsAt: '2027-01-05T01:00:00.000Z',
          }),
        );

      expect(response.status).toBe(400);
    });

    it('rejects a day with no matching schedule with 400', async () => {
      const resourceId = await createMondayResource(); // schedule is Monday only

      const response = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: '2027-01-05T09:00:00.000Z', // Tuesday
            endsAt: '2027-01-05T10:00:00.000Z',
          }),
        );

      expect(response.status).toBe(400);
    });

    it('rejects a range only partially inside the schedule window with 400', async () => {
      const resourceId = await createMondayResource(); // window ends 18:00

      const response = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T17:00:00.000Z`,
            endsAt: `${MONDAY}T19:00:00.000Z`,
          }),
        );

      expect(response.status).toBe(400);
    });

    it('rejects a duration below minBookingMinutes with 400', async () => {
      const resourceId = await createMondayResource();

      const response = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T09:00:00.000Z`,
            endsAt: `${MONDAY}T09:10:00.000Z`,
          }),
        );

      expect(response.status).toBe(400);
    });

    it('rejects a duration above maxBookingMinutes with 400', async () => {
      const resourceId = await createMondayResource(); // max 120 minutes

      const response = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T09:00:00.000Z`,
            endsAt: `${MONDAY}T12:00:00.000Z`,
          }),
        );

      expect(response.status).toBe(400);
    });
  });

  describe('POST /v1/reservations — overlap', () => {
    it('rejects an overlapping booking on the same resource with 409', async () => {
      const resourceId = await createMondayResource();
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));

      const response = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T09:30:00.000Z`,
            endsAt: `${MONDAY}T10:30:00.000Z`,
          }),
        );

      expect(response.status).toBe(409);
    });
  });

  describe('GET /v1/reservations — list scoping', () => {
    it("silently overrides a USER's foreign userId filter to their own", async () => {
      const resourceId = await createMondayResource();
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T11:00:00.000Z`,
            endsAt: `${MONDAY}T12:00:00.000Z`,
          }),
        );

      const response = await request(app.getHttpServer())
        .get(`/v1/reservations?userId=${adminUser.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].userId).toBe(ownerUser.id);
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it("honours ADMIN's userId filter, and omitted means all users", async () => {
      const resourceId = await createMondayResource();
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T11:00:00.000Z`,
            endsAt: `${MONDAY}T12:00:00.000Z`,
          }),
        );

      const filtered = await request(app.getHttpServer())
        .get(`/v1/reservations?userId=${ownerUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(filtered.status).toBe(200);
      expect(filtered.body.data).toHaveLength(1);
      expect(filtered.body.data[0].userId).toBe(ownerUser.id);

      const all = await request(app.getHttpServer())
        .get('/v1/reservations')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(2);
      expect(all.body.meta.total).toBe(2);
    });

    it('defaults to confirmed + upcoming, hiding a cancelled reservation', async () => {
      const resourceId = await createMondayResource();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));
      await request(app.getHttpServer())
        .patch(`/v1/reservations/${created.body.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`);
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T11:00:00.000Z`,
            endsAt: `${MONDAY}T12:00:00.000Z`,
          }),
        );

      const response = await request(app.getHttpServer())
        .get('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('confirmed');
    });

    it('limit=1 returns only 1 item while meta.total reflects the real total', async () => {
      const resourceId = await createMondayResource();
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T11:00:00.000Z`,
            endsAt: `${MONDAY}T12:00:00.000Z`,
          }),
        );

      const response = await request(app.getHttpServer())
        .get('/v1/reservations?limit=1')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
    });

    it('a page beyond the last one returns an empty data array', async () => {
      const resourceId = await createMondayResource();
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));

      const response = await request(app.getHttpServer())
        .get('/v1/reservations?page=5&limit=10')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.meta.total).toBe(1);
    });
  });

  describe('PATCH /v1/reservations/:id/reschedule', () => {
    it('succeeds when rescheduling to a free slot', async () => {
      const resourceId = await createMondayResource();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));

      const response = await request(app.getHttpServer())
        .patch(`/v1/reservations/${created.body.id}/reschedule`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          startsAt: `${MONDAY}T14:00:00.000Z`,
          endsAt: `${MONDAY}T15:00:00.000Z`,
        });

      expect(response.status).toBe(200);
      expect(response.body.startsAt).toBe(`${MONDAY}T14:00:00.000Z`);
      expect(response.body.endsAt).toBe(`${MONDAY}T15:00:00.000Z`);
    });

    it('rejects a reschedule into a conflicting slot with 409, leaving the original row unchanged', async () => {
      const resourceId = await createMondayResource();
      const x = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(
          reservationPayload({
            resourceId,
            startsAt: `${MONDAY}T13:00:00.000Z`,
            endsAt: `${MONDAY}T14:00:00.000Z`,
          }),
        );

      const response = await request(app.getHttpServer())
        .patch(`/v1/reservations/${x.body.id}/reschedule`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          startsAt: `${MONDAY}T13:30:00.000Z`,
          endsAt: `${MONDAY}T14:30:00.000Z`,
        });

      expect(response.status).toBe(409);

      const stillThere = await request(app.getHttpServer())
        .get(`/v1/reservations/${x.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(stillThere.body.startsAt).toBe(`${MONDAY}T09:00:00.000Z`);
      expect(stillThere.body.endsAt).toBe(`${MONDAY}T10:00:00.000Z`);
    });
  });

  describe('PATCH /v1/reservations/:id/cancel — future, in-progress, and past', () => {
    it('cancels a future reservation with 200', async () => {
      const resourceId = await createMondayResource();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));

      const response = await request(app.getHttpServer())
        .patch(`/v1/reservations/${created.body.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('cancelled');
    });

    it('cancels an in-progress reservation with 200, and the freed range becomes bookable again', async () => {
      const resourceId = await createTodayAllDayResource();
      const now = Date.now();
      const startsAt = new Date(now + 2 * 60_000);
      const endsAt = new Date(now + 62 * 60_000);
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          resourceId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        });
      expect(created.status).toBe(201);

      // Bypass the API (which forbids a past startsAt) to genuinely
      // straddle "now": already started, not yet ended.
      await dataSource.query(
        'UPDATE "reservations" SET starts_at = $1 WHERE id = $2',
        [new Date(now - 5 * 60_000).toISOString(), created.body.id],
      );

      const cancelResponse = await request(app.getHttpServer())
        .patch(`/v1/reservations/${created.body.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(cancelResponse.status).toBe(200);
      expect(cancelResponse.body.status).toBe('cancelled');

      // A new booking overlapping the cancelled in-progress range succeeds.
      const rebook = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          resourceId,
          startsAt: new Date(now + 5 * 60_000).toISOString(),
          endsAt: new Date(now + 35 * 60_000).toISOString(),
        });
      expect(rebook.status).toBe(201);
    });

    it('cancels an already-ended (past) reservation with 200', async () => {
      const resourceId = await createTodayAllDayResource();
      const now = Date.now();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          resourceId,
          startsAt: new Date(now + 2 * 60_000).toISOString(),
          endsAt: new Date(now + 32 * 60_000).toISOString(),
        });
      expect(created.status).toBe(201);

      await dataSource.query(
        'UPDATE "reservations" SET starts_at = $1, ends_at = $2 WHERE id = $3',
        [
          new Date(now - 120 * 60_000).toISOString(),
          new Date(now - 60 * 60_000).toISOString(),
          created.body.id,
        ],
      );

      const response = await request(app.getHttpServer())
        .patch(`/v1/reservations/${created.body.id}/cancel`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('cancelled');
    });
  });

  describe('ownership matrix — non-owner, non-admin gets 403 with no change applied', () => {
    it('GET /v1/reservations/:id returns 403 for a foreign non-admin caller', async () => {
      const resourceId = await createMondayResource();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));

      const response = await request(app.getHttpServer())
        .get(`/v1/reservations/${created.body.id}`)
        .set('Authorization', `Bearer ${foreignToken}`);

      expect(response.status).toBe(403);
    });

    it('PATCH /cancel returns 403 for a foreign non-admin caller and applies no change', async () => {
      const resourceId = await createMondayResource();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));

      const response = await request(app.getHttpServer())
        .patch(`/v1/reservations/${created.body.id}/cancel`)
        .set('Authorization', `Bearer ${foreignToken}`);
      expect(response.status).toBe(403);

      const stillThere = await request(app.getHttpServer())
        .get(`/v1/reservations/${created.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(stillThere.body.status).toBe('confirmed');
    });

    it('PATCH /reschedule returns 403 for a foreign non-admin caller and applies no change', async () => {
      const resourceId = await createMondayResource();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));

      const response = await request(app.getHttpServer())
        .patch(`/v1/reservations/${created.body.id}/reschedule`)
        .set('Authorization', `Bearer ${foreignToken}`)
        .send({
          startsAt: `${MONDAY}T14:00:00.000Z`,
          endsAt: `${MONDAY}T15:00:00.000Z`,
        });
      expect(response.status).toBe(403);

      const stillThere = await request(app.getHttpServer())
        .get(`/v1/reservations/${created.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(stillThere.body.startsAt).toBe(`${MONDAY}T09:00:00.000Z`);
    });
  });

  describe('Non-retroactive resource changes — existing reservations are unaffected', () => {
    it('deactivating the resource afterwards leaves the reservation confirmed and unchanged', async () => {
      const resourceId = await createMondayResource();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));
      expect(created.status).toBe(201);

      const deactivate = await request(app.getHttpServer())
        .patch(`/v1/resources/${resourceId}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deactivate.status).toBe(200);

      const stillThere = await request(app.getHttpServer())
        .get(`/v1/reservations/${created.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(stillThere.status).toBe(200);
      expect(stillThere.body.status).toBe('confirmed');
      expect(stillThere.body.startsAt).toBe(`${MONDAY}T09:00:00.000Z`);
      expect(stillThere.body.endsAt).toBe(`${MONDAY}T10:00:00.000Z`);
    });

    it('replacing the resource schedule afterwards leaves the reservation confirmed and unchanged', async () => {
      const resourceId = await createMondayResource();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(reservationPayload({ resourceId }));
      expect(created.status).toBe(201);

      // Replace the Monday window with a Tuesday-only window — the existing
      // Monday 09:00-10:00 reservation no longer fits any current schedule.
      const update = await request(app.getHttpServer())
        .patch(`/v1/resources/${resourceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          schedules: [{ dayOfWeek: 2, openTime: '09:00', closeTime: '18:00' }],
        });
      expect(update.status).toBe(200);

      const stillThere = await request(app.getHttpServer())
        .get(`/v1/reservations/${created.body.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(stillThere.status).toBe(200);
      expect(stillThere.body.status).toBe('confirmed');
      expect(stillThere.body.startsAt).toBe(`${MONDAY}T09:00:00.000Z`);
      expect(stillThere.body.endsAt).toBe(`${MONDAY}T10:00:00.000Z`);
    });
  });
});
