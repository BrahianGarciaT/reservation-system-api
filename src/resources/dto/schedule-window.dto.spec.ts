import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ScheduleWindowDto } from './schedule-window.dto.js';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(ScheduleWindowDto, input);
  return validate(dto);
}

describe('ScheduleWindowDto', () => {
  it('has no validation errors for a valid window', async () => {
    const errors = await validateInput({
      dayOfWeek: 1,
      openTime: '09:00',
      closeTime: '17:30',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects a dayOfWeek outside 0-6', async () => {
    const errors = await validateInput({
      dayOfWeek: 7,
      openTime: '09:00',
      closeTime: '17:00',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('dayOfWeek');
  });

  it('rejects a negative dayOfWeek', async () => {
    const errors = await validateInput({
      dayOfWeek: -1,
      openTime: '09:00',
      closeTime: '17:00',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('dayOfWeek');
  });

  it('rejects an openTime that does not match HH:MM', async () => {
    const errors = await validateInput({
      dayOfWeek: 2,
      openTime: '9:00',
      closeTime: '17:00',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('openTime');
  });

  it('rejects a closeTime with an out-of-range hour', async () => {
    const errors = await validateInput({
      dayOfWeek: 2,
      openTime: '09:00',
      closeTime: '24:00',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('closeTime');
  });

  it('rejects a window where closeTime equals openTime', async () => {
    const errors = await validateInput({
      dayOfWeek: 1,
      openTime: '12:00',
      closeTime: '12:00',
    });

    expect(errors.map((e) => e.property)).toContain('closeTime');
  });

  it('rejects a window where closeTime is before openTime', async () => {
    const errors = await validateInput({
      dayOfWeek: 1,
      openTime: '14:00',
      closeTime: '10:00',
    });

    expect(errors.map((e) => e.property)).toContain('closeTime');
  });

  it('accepts dayOfWeek 0 (Sunday) as a valid boundary', async () => {
    const errors = await validateInput({
      dayOfWeek: 0,
      openTime: '00:00',
      closeTime: '23:59',
    });

    expect(errors).toHaveLength(0);
  });
});
