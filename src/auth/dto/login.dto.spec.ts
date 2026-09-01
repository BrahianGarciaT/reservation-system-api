import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto.js';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(LoginDto, input);
  return validate(dto);
}

describe('LoginDto', () => {
  it('has no validation errors for a valid email and non-empty password', async () => {
    const errors = await validateInput({
      email: 'alice@example.com',
      password: 'anything',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const errors = await validateInput({
      email: 'not-an-email',
      password: 'anything',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('email');
  });

  it('rejects an empty password with no policy re-check', async () => {
    const errors = await validateInput({
      email: 'alice@example.com',
      password: '',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('password');
  });
});
