import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateResourceDto } from './update-resource.dto.js';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(UpdateResourceDto, input);
  return { dto, errors: await validate(dto) };
}

describe('UpdateResourceDto', () => {
  it('has no validation errors for an empty payload (all fields optional)', async () => {
    const { errors } = await validateInput({});

    expect(errors).toHaveLength(0);
  });

  it('has no validation errors when only name is supplied', async () => {
    const { errors } = await validateInput({ name: 'Room B' });

    expect(errors).toHaveLength(0);
  });

  describe('schedules discriminator (absent vs [] vs null)', () => {
    it('leaves schedules undefined when the key is absent', async () => {
      const { dto, errors } = await validateInput({ name: 'Room C' });

      expect(dto.schedules).toBeUndefined();
      expect(errors).toHaveLength(0);
    });

    it('accepts an explicit empty array as a defined, valid replacement', async () => {
      const { dto, errors } = await validateInput({ schedules: [] });

      expect(dto.schedules).toEqual([]);
      expect(errors).toHaveLength(0);
    });

    it('rejects an explicit null for schedules', async () => {
      const { errors } = await validateInput({ schedules: null });

      expect(errors.map((e) => e.property)).toContain('schedules');
    });

    it('accepts a non-empty schedules array with valid windows', async () => {
      const { dto, errors } = await validateInput({
        schedules: [{ dayOfWeek: 2, openTime: '08:00', closeTime: '10:00' }],
      });

      expect(dto.schedules).toHaveLength(1);
      expect(errors).toHaveLength(0);
    });

    it('rejects a non-empty schedules array containing an invalid window', async () => {
      const { errors } = await validateInput({
        schedules: [{ dayOfWeek: 9, openTime: '08:00', closeTime: '10:00' }],
      });

      expect(errors.map((e) => e.property)).toContain('schedules');
    });
  });
});
