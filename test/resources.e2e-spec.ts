import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { UserRole } from '../src/users/user-role.enum.js';
import { User } from '../src/users/user.entity.js';

const JWT_SECRET = 'test-secret-for-resources-e2e';

function signToken(role: UserRole, sub: string): string {
  return jwt.sign({ sub, role }, JWT_SECRET, { expiresIn: '1h' });
}

// A fixed far-future Monday, safely past any conceivable test-run "now" —
// mirrors the convention in reservations.e2e-spec.ts.
const MONDAY = '2027-01-04'; // 2027-01-04T00:00:00Z is a Monday (UTC day 1)
const AVAILABILITY_OWNER_EMAIL = 'resources-e2e-availability-owner@example.com';

describe('Resources (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let userToken: string;
  let availabilityOwner: User;
  let availabilityOwnerToken: string;

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
    adminToken = signToken(UserRole.ADMIN, 'admin-1');
    userToken = signToken(UserRole.USER, 'user-1');

    // Reservations FK `user_id` to a real `users` row, unlike Resource — so
    // the availability suite below (which creates real reservations to
    // prove they reduce free intervals) needs a seeded user, not a bare
    // signed sub like adminToken/userToken above.
    const userRepository = dataSource.getRepository(User);
    await userRepository.delete({ email: AVAILABILITY_OWNER_EMAIL });
    availabilityOwner = await userRepository.save({
      email: AVAILABILITY_OWNER_EMAIL,
      passwordHash: 'unused-hash',
      role: UserRole.USER,
    });
    availabilityOwnerToken = signToken(UserRole.USER, availabilityOwner.id);
  });

  afterAll(async () => {
    await dataSource.getRepository(User).delete(availabilityOwner.id);
    await app.close();
  });

  afterEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE "resource_schedules", "resources" CASCADE',
    );
  });

  function validPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Room A',
      capacity: 4,
      minBookingMinutes: 30,
      maxBookingMinutes: 60,
      ...overrides,
    };
  }

  describe('POST /v1/resources — role matrix', () => {
    it('rejects an anonymous request with 401 and creates nothing', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/resources')
        .send(validPayload());

      expect(response.status).toBe(401);
    });

    it('rejects a role:user request with 403 and creates nothing', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${userToken}`)
        .send(validPayload());

      expect(response.status).toBe(403);
    });

    it('creates the resource for an admin with 201', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload());

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('Room A');
    });
  });

  describe('POST /v1/resources — create with schedules', () => {
    it('persists a resource with nested schedules and defaults isActive to true', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            schedules: [
              { dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' },
              { dayOfWeek: 2, openTime: '10:00', closeTime: '15:00' },
            ],
          }),
        );

      expect(response.status).toBe(201);
      expect(response.body.isActive).toBe(true);
      expect(response.body.schedules).toHaveLength(2);
    });
  });

  describe('POST /v1/resources — field validation 400s', () => {
    it('rejects minBookingMinutes not a multiple of 30', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload({ minBookingMinutes: 45 }));

      expect(response.status).toBe(400);
    });

    it('rejects capacity < 1', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload({ capacity: 0 }));

      expect(response.status).toBe(400);
    });

    it('rejects a schedule with closeTime <= openTime', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            schedules: [
              { dayOfWeek: 1, openTime: '12:00', closeTime: '12:00' },
            ],
          }),
        );

      expect(response.status).toBe(400);
    });

    it('rejects a schedule with dayOfWeek: 7', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            schedules: [{ dayOfWeek: 7, openTime: '09:00', closeTime: '12:00' }],
          }),
        );

      expect(response.status).toBe(400);
    });
  });

  describe('GET /v1/resources — listing', () => {
    async function seedActiveAndInactive() {
      const active = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload({ name: 'Active Room' }));

      const inactiveSeed = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload({ name: 'Inactive Room' }));

      await request(app.getHttpServer())
        .patch(`/v1/resources/${inactiveSeed.body.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      return { activeId: active.body.id, inactiveId: inactiveSeed.body.id };
    }

    it('hides inactive resources for a regular user by default', async () => {
      await seedActiveAndInactive();

      const response = await request(app.getHttpServer())
        .get('/v1/resources')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Active Room');
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('returns both active and inactive for an admin with includeInactive=true', async () => {
      await seedActiveAndInactive();

      const response = await request(app.getHttpServer())
        .get('/v1/resources?includeInactive=true')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta.total).toBe(2);
    });

    it('rejects includeInactive=true for a regular user with 403', async () => {
      await seedActiveAndInactive();

      const response = await request(app.getHttpServer())
        .get('/v1/resources?includeInactive=true')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('returns exactly one item and the real total when limit=1', async () => {
      await seedActiveAndInactive();

      const response = await request(app.getHttpServer())
        .get('/v1/resources?includeInactive=true&limit=1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
    });

    it('returns the second page with the remaining item when page=2&limit=1', async () => {
      await seedActiveAndInactive();

      const response = await request(app.getHttpServer())
        .get('/v1/resources?includeInactive=true&limit=1&page=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.page).toBe(2);
    });
  });

  describe('GET /v1/resources/:id', () => {
    it('returns 401 for an anonymous request', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload());

      const response = await request(app.getHttpServer()).get(
        `/v1/resources/${created.body.id}`,
      );

      expect(response.status).toBe(401);
    });

    it('returns an inactive resource with its schedules to an authenticated user', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            schedules: [{ dayOfWeek: 3, openTime: '09:00', closeTime: '12:00' }],
          }),
        );
      await request(app.getHttpServer())
        .patch(`/v1/resources/${created.body.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      const response = await request(app.getHttpServer())
        .get(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(false);
      expect(response.body.schedules).toHaveLength(1);
    });
  });

  describe('PATCH /v1/resources/:id — replace semantics', () => {
    it('rejects a role:user request with 403 and applies no change', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload({ name: 'Original Name' }));

      const response = await request(app.getHttpServer())
        .patch(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Hijacked Name' });

      expect(response.status).toBe(403);

      const stillOriginal = await request(app.getHttpServer())
        .get(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(stillOriginal.body.name).toBe('Original Name');
    });

    it('preserves existing windows when the schedules key is omitted', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            schedules: [
              { dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' },
              { dayOfWeek: 2, openTime: '09:00', closeTime: '12:00' },
            ],
          }),
        );

      const response = await request(app.getHttpServer())
        .patch(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Room B' });

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('Room B');
      expect(response.body.schedules).toHaveLength(2);
    });

    it('replaces all windows when an explicit non-empty schedules array is sent', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            schedules: [
              { dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' },
              { dayOfWeek: 2, openTime: '09:00', closeTime: '12:00' },
            ],
          }),
        );

      const response = await request(app.getHttpServer())
        .patch(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          schedules: [{ dayOfWeek: 5, openTime: '08:00', closeTime: '10:00' }],
        });

      expect(response.status).toBe(200);
      expect(response.body.schedules).toHaveLength(1);
      expect(response.body.schedules[0].dayOfWeek).toBe(5);
    });

    it('clears all windows when an explicit empty schedules array is sent', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            schedules: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' }],
          }),
        );

      const response = await request(app.getHttpServer())
        .patch(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ schedules: [] });

      expect(response.status).toBe(200);
      expect(response.body.schedules).toHaveLength(0);
    });

    it('rolls back a rejected overlapping replacement, leaving prior windows intact', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            schedules: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' }],
          }),
        );

      const response = await request(app.getHttpServer())
        .patch(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          schedules: [
            { dayOfWeek: 1, openTime: '09:00', closeTime: '11:00' },
            { dayOfWeek: 1, openTime: '10:00', closeTime: '13:00' },
          ],
        });

      expect(response.status).toBeGreaterThanOrEqual(400);

      const stillThere = await request(app.getHttpServer())
        .get(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(stillThere.body.schedules).toHaveLength(1);
      expect(stillThere.body.schedules[0].openTime).toBe('09:00:00');
    });
  });

  describe('PATCH /v1/resources/:id/deactivate and DELETE non-existence', () => {
    it('deactivates for an admin with 200 and the row remains GET-able', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload());

      const response = await request(app.getHttpServer())
        .patch(`/v1/resources/${created.body.id}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(false);

      const stillThere = await request(app.getHttpServer())
        .get(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(stillThere.status).toBe(200);
    });

    it('rejects deactivate for a regular user with 403 and leaves isActive unchanged', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload());

      const response = await request(app.getHttpServer())
        .patch(`/v1/resources/${created.body.id}/deactivate`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);

      const stillActive = await request(app.getHttpServer())
        .get(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(stillActive.body.isActive).toBe(true);
    });

    it('returns 404 for DELETE /v1/resources/:id since no delete route exists', async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validPayload());

      const response = await request(app.getHttpServer())
        .delete(`/v1/resources/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('GET /v1/resources/:id/availability', () => {
    async function createMondayResource(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const response = await request(app.getHttpServer())
        .post('/v1/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(
          validPayload({
            schedules: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '18:00' }],
            ...overrides,
          }),
        );
      return response.body.id;
    }

    it('returns 401 for an anonymous request', async () => {
      const resourceId = await createMondayResource();

      const response = await request(app.getHttpServer()).get(
        `/v1/resources/${resourceId}/availability?from=${MONDAY}T00:00:00.000Z&to=2027-01-05T00:00:00.000Z`,
      );

      expect(response.status).toBe(401);
    });

    it('returns 404 for a resource that does not exist', async () => {
      const response = await request(app.getHttpServer())
        .get(
          `/v1/resources/00000000-0000-0000-0000-000000000000/availability?from=${MONDAY}T00:00:00.000Z&to=2027-01-05T00:00:00.000Z`,
        )
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(404);
    });

    it('returns 400 when to is not after from', async () => {
      const resourceId = await createMondayResource();

      const response = await request(app.getHttpServer())
        .get(
          `/v1/resources/${resourceId}/availability?from=2027-01-05T00:00:00.000Z&to=${MONDAY}T00:00:00.000Z`,
        )
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(400);
    });

    it('returns 400 when the range exceeds the maximum availability window', async () => {
      const resourceId = await createMondayResource();

      const response = await request(app.getHttpServer())
        .get(
          `/v1/resources/${resourceId}/availability?from=${MONDAY}T00:00:00.000Z&to=2027-12-01T00:00:00.000Z`,
        )
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(400);
    });

    it('returns the full schedule window as free when there are no reservations', async () => {
      const resourceId = await createMondayResource();

      const response = await request(app.getHttpServer())
        .get(
          `/v1/resources/${resourceId}/availability?from=${MONDAY}T00:00:00.000Z&to=2027-01-05T00:00:00.000Z`,
        )
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.freeIntervals).toEqual([
        {
          startsAt: `${MONDAY}T09:00:00.000Z`,
          endsAt: `${MONDAY}T18:00:00.000Z`,
        },
      ]);
    });

    it('splits the free window around a CONFIRMED reservation', async () => {
      const resourceId = await createMondayResource();
      await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${availabilityOwnerToken}`)
        .send({
          resourceId,
          startsAt: `${MONDAY}T10:00:00.000Z`,
          endsAt: `${MONDAY}T11:00:00.000Z`,
        });

      const response = await request(app.getHttpServer())
        .get(
          `/v1/resources/${resourceId}/availability?from=${MONDAY}T00:00:00.000Z&to=2027-01-05T00:00:00.000Z`,
        )
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.freeIntervals).toEqual([
        {
          startsAt: `${MONDAY}T09:00:00.000Z`,
          endsAt: `${MONDAY}T10:00:00.000Z`,
        },
        {
          startsAt: `${MONDAY}T11:00:00.000Z`,
          endsAt: `${MONDAY}T18:00:00.000Z`,
        },
      ]);
    });

    it('does not reduce availability for a CANCELLED reservation', async () => {
      const resourceId = await createMondayResource();
      const created = await request(app.getHttpServer())
        .post('/v1/reservations')
        .set('Authorization', `Bearer ${availabilityOwnerToken}`)
        .send({
          resourceId,
          startsAt: `${MONDAY}T10:00:00.000Z`,
          endsAt: `${MONDAY}T11:00:00.000Z`,
        });
      await request(app.getHttpServer())
        .patch(`/v1/reservations/${created.body.id}/cancel`)
        .set('Authorization', `Bearer ${availabilityOwnerToken}`);

      const response = await request(app.getHttpServer())
        .get(
          `/v1/resources/${resourceId}/availability?from=${MONDAY}T00:00:00.000Z&to=2027-01-05T00:00:00.000Z`,
        )
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.freeIntervals).toEqual([
        {
          startsAt: `${MONDAY}T09:00:00.000Z`,
          endsAt: `${MONDAY}T18:00:00.000Z`,
        },
      ]);
    });

    it('returns an empty freeIntervals array for an inactive resource', async () => {
      const resourceId = await createMondayResource();
      await request(app.getHttpServer())
        .patch(`/v1/resources/${resourceId}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      const response = await request(app.getHttpServer())
        .get(
          `/v1/resources/${resourceId}/availability?from=${MONDAY}T00:00:00.000Z&to=2027-01-05T00:00:00.000Z`,
        )
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.freeIntervals).toEqual([]);
    });
  });
});
