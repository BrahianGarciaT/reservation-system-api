import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RescheduleReservationDto } from './reschedule-reservation.dto.js';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    startsAt: '2027-01-04T09:00:00.000Z',
    endsAt: '2027-01-04T10:00:00.000Z',
    ...overrides,
  };
}

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(RescheduleReservationDto, input);
  return validate(dto);
}

describe('RescheduleReservationDto', () => {
  it('has no validation errors for a minimal valid payload', async () => {
    const errors = await validateInput(validPayload());

    expect(errors).toHaveLength(0);
  });

  it('rejects a missing startsAt', async () => {
    const errors = await validateInput(validPayload({ startsAt: undefined }));

    expect(errors.map((e) => e.property)).toContain('startsAt');
  });

  it('rejects a missing endsAt', async () => {
    const errors = await validateInput(validPayload({ endsAt: undefined }));

    expect(errors.map((e) => e.property)).toContain('endsAt');
  });

  it('rejects a non-ISO-8601 startsAt', async () => {
    const errors = await validateInput(validPayload({ startsAt: '01/04/2027' }));

    expect(errors.map((e) => e.property)).toContain('startsAt');
  });

  it('rejects a resourceId field under forbidNonWhitelisted (resource is immutable via reschedule)', async () => {
    const dto = plainToInstance(RescheduleReservationDto, {
      ...validPayload(),
      resourceId: '11111111-1111-4111-8111-111111111111',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((e) => e.property)).toContain('resourceId');
  });
});
