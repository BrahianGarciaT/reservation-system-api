import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateResourceDto } from './create-resource.dto.js';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Room A',
    capacity: 4,
    minBookingMinutes: 30,
    maxBookingMinutes: 60,
    ...overrides,
  };
}

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(CreateResourceDto, input);
  return validate(dto);
}

describe('CreateResourceDto', () => {
  it('has no validation errors for a minimal valid payload', async () => {
    const errors = await validateInput(validPayload());

    expect(errors).toHaveLength(0);
  });

  it('has no validation errors when optional fields and nested schedules are supplied', async () => {
    const errors = await validateInput(
      validPayload({
        notes: 'Has a whiteboard',
        amenities: ['projector', 'whiteboard'],
        schedules: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '12:00' }],
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('rejects capacity < 1', async () => {
    const errors = await validateInput(validPayload({ capacity: 0 }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('capacity');
  });

  it('rejects minBookingMinutes not a multiple of 30', async () => {
    const errors = await validateInput(
      validPayload({ minBookingMinutes: 45 }),
    );

    expect(errors.map((e) => e.property)).toContain('minBookingMinutes');
  });

  it('rejects minBookingMinutes below 30', async () => {
    const errors = await validateInput(
      validPayload({ minBookingMinutes: 15, maxBookingMinutes: 30 }),
    );

    expect(errors.map((e) => e.property)).toContain('minBookingMinutes');
  });

  it('rejects maxBookingMinutes less than minBookingMinutes', async () => {
    const errors = await validateInput(
      validPayload({ minBookingMinutes: 60, maxBookingMinutes: 30 }),
    );

    expect(errors.map((e) => e.property)).toContain('maxBookingMinutes');
  });

  it('rejects a nested schedule with an invalid dayOfWeek', async () => {
    const errors = await validateInput(
      validPayload({
        schedules: [{ dayOfWeek: 7, openTime: '09:00', closeTime: '12:00' }],
      }),
    );

    expect(errors.map((e) => e.property)).toContain('schedules');
  });

  it('rejects an empty name', async () => {
    const errors = await validateInput(validPayload({ name: '' }));

    expect(errors.map((e) => e.property)).toContain('name');
  });
});
