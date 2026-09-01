import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UserRole } from '../src/users/user-role.enum.js';
import { GuardProofFixtureModule } from './fixtures/guard-proof.fixture.module.js';

const JWT_SECRET = 'test-secret';

function signToken(
  payload: Record<string, unknown>,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h', ...options });
}

describe('Guard proof (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const moduleRef = await Test.createTestingModule({
      imports: [GuardProofFixtureModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows an unauthenticated request to a @Public() route', async () => {
    const response = await request(app.getHttpServer()).get(
      '/fixtures/public',
    );

    expect(response.status).toBe(200);
  });

  it('rejects a protected route with no Authorization header', async () => {
    const response = await request(app.getHttpServer()).get(
      '/fixtures/protected',
    );

    expect(response.status).toBe(401);
  });

  it('rejects a protected route with an expired token', async () => {
    const token = signToken(
      { sub: 'user-1', email: 'a@b.com', role: UserRole.USER },
      { expiresIn: '-10s' },
    );

    const response = await request(app.getHttpServer())
      .get('/fixtures/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('rejects an admin-only route for a valid user-role token', async () => {
    const token = signToken({
      sub: 'user-1',
      email: 'a@b.com',
      role: UserRole.USER,
    });

    const response = await request(app.getHttpServer())
      .get('/fixtures/admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('allows an admin-only route for a valid admin-role token', async () => {
    const token = signToken({
      sub: 'admin-1',
      email: 'admin@b.com',
      role: UserRole.ADMIN,
    });

    const response = await request(app.getHttpServer())
      .get('/fixtures/admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, sub: 'admin-1' });
  });
});
