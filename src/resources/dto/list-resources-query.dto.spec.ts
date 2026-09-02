import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListResourcesQueryDto } from './list-resources-query.dto.js';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(ListResourcesQueryDto, input);
  return { dto, errors: await validate(dto) };
}

describe('ListResourcesQueryDto', () => {
  it('defaults includeInactive to undefined when the query key is absent', async () => {
    const { dto, errors } = await validateInput({});

    expect(dto.includeInactive).toBeUndefined();
    expect(errors).toHaveLength(0);
  });

  it('transforms the query string "true" into boolean true', async () => {
    const { dto, errors } = await validateInput({ includeInactive: 'true' });

    expect(dto.includeInactive).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('transforms the query string "false" into boolean false', async () => {
    const { dto, errors } = await validateInput({ includeInactive: 'false' });

    expect(dto.includeInactive).toBe(false);
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-boolean-like value', async () => {
    const { errors } = await validateInput({ includeInactive: 'maybe' });

    expect(errors.map((e) => e.property)).toContain('includeInactive');
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
