import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReservationStatus } from '../reservation-status.enum.js';
import { FindReservationsQueryDto } from './find-reservations-query.dto.js';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(FindReservationsQueryDto, input);
  return { dto, errors: await validate(dto) };
}

describe('FindReservationsQueryDto', () => {
  it('has no validation errors when every filter is omitted', async () => {
    const { errors } = await validateInput({});

    expect(errors).toHaveLength(0);
  });

  it('accepts a valid userId, resourceId, status, from and to', async () => {
    const { errors } = await validateInput({
      userId: '11111111-1111-4111-8111-111111111111',
      resourceId: '22222222-2222-4222-8222-222222222222',
      status: ReservationStatus.CANCELLED,
      from: '2027-01-01T00:00:00.000Z',
      to: '2027-01-31T00:00:00.000Z',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects a non-UUID userId', async () => {
    const errors = (await validateInput({ userId: 'not-a-uuid' })).errors;

    expect(errors.map((e) => e.property)).toContain('userId');
  });

  it('rejects a non-UUID resourceId', async () => {
    const errors = (await validateInput({ resourceId: 'not-a-uuid' })).errors;

    expect(errors.map((e) => e.property)).toContain('resourceId');
  });

  it('rejects a status outside the ReservationStatus enum', async () => {
    const errors = (await validateInput({ status: 'bogus' })).errors;

    expect(errors.map((e) => e.property)).toContain('status');
  });

  it('rejects a non-ISO-8601 from', async () => {
    const errors = (await validateInput({ from: '01/04/2027' })).errors;

    expect(errors.map((e) => e.property)).toContain('from');
  });

  it('rejects a non-ISO-8601 to', async () => {
    const errors = (await validateInput({ to: '01/04/2027' })).errors;

    expect(errors.map((e) => e.property)).toContain('to');
  });

  it('defaults page and limit when omitted', async () => {
    const { dto, errors } = await validateInput({});

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('transforms numeric query string page/limit into numbers', async () => {
    const { dto, errors } = await validateInput({ page: '2', limit: '50' });

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
  });

  it('rejects a limit above 100', async () => {
    const errors = (await validateInput({ limit: '101' })).errors;

    expect(errors.map((e) => e.property)).toContain('limit');
  });

  it('rejects a page below 1', async () => {
    const errors = (await validateInput({ page: '0' })).errors;

    expect(errors.map((e) => e.property)).toContain('page');
  });
});
