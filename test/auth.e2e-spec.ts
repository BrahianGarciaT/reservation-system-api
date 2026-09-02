import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-auth-e2e';

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
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // CASCADE is required now that "reservations" holds a FK to "users":
    // a plain TRUNCATE fails once ANY table references "users", even when
    // no reservation rows exist yet (added by the reservations migration).
    await dataSource.query('TRUNCATE TABLE "users" CASCADE');
  });

  describe('GET /health', () => {
    it('is reachable without authentication now that global guards are wired', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      // Proves HealthController's @Public() bypass survives the real
      // globally-registered JwtAuthGuard/RolesGuard from AuthModule — a
      // missing @Public() here would return 401, never a health payload.
      expect(response.status).not.toBe(401);
      expect(response.body).toHaveProperty('status');
    });
  });

  describe('POST /v1/auth/register', () => {
    it('creates a role: user account and never returns the password', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: 'newuser@example.com', password: 'secret123' });

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('user');
      expect(response.body.user.email).toBe('newuser@example.com');
      expect(response.body).not.toHaveProperty('password');
      expect(response.body.user).not.toHaveProperty('password');
      expect(response.body.user).not.toHaveProperty('passwordHash');
      expect(typeof response.body.accessToken).toBe('string');
    });

    it('rejects a client-supplied role field via forbidNonWhitelisted, creating no user', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({
          email: 'wannabe-admin@example.com',
          password: 'secret123',
          role: 'admin',
        });

      expect(response.status).toBe(400);

      const loginAttempt = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'wannabe-admin@example.com', password: 'secret123' });
      expect(loginAttempt.status).toBe(401);
    });

    it('rejects a password shorter than the policy with 400 and creates no user', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: 'weak@example.com', password: 'ab1' });

      expect(response.status).toBe(400);

      const loginAttempt = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'weak@example.com', password: 'ab1' });
      expect(loginAttempt.status).toBe(401);
    });

    it('rejects a duplicate email (case-insensitive) with 409', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: 'dupe@example.com', password: 'secret123' });

      const response = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: 'Dupe@Example.com', password: 'secret456' });

      expect(response.status).toBe(409);
    });
  });

  describe('POST /v1/auth/login', () => {
    it('returns 200 with an accessToken for valid credentials', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: 'loginok@example.com', password: 'secret123' });

      const response = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'loginok@example.com', password: 'secret123' });

      expect(response.status).toBe(200);
      expect(typeof response.body.accessToken).toBe('string');

      // Regression proof for the JWT Claim Shape requirement: decode the
      // real signed token and assert it carries exactly sub/role/iat/exp —
      // no email or other PII.
      const decoded = jwt.decode(response.body.accessToken, { json: true });
      expect(decoded).not.toBeNull();
      expect(Object.keys(decoded ?? {}).sort()).toEqual([
        'exp',
        'iat',
        'role',
        'sub',
      ]);
      expect(decoded).not.toHaveProperty('email');
      expect(decoded?.role).toBe('user');
    });

    it('returns a generic 401 for an unknown email', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'nobody-here@example.com', password: 'whatever1' });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid credentials');
    });

    it('returns the identical 401 message for a wrong password', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: 'wrongpass@example.com', password: 'secret123' });

      const response = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'wrongpass@example.com', password: 'incorrect99' });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid credentials');
    });
  });
});
