import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto.js';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(RegisterDto, input);
  return validate(dto);
}

describe('RegisterDto', () => {
  it('has no validation errors for a valid email and policy-valid password', async () => {
    const errors = await validateInput({
      email: 'alice@example.com',
      password: 'secret123',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const errors = await validateInput({
      email: 'not-an-email',
      password: 'secret123',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('email');
  });

  it('rejects a password shorter than 8 characters', async () => {
    const errors = await validateInput({
      email: 'alice@example.com',
      password: 'ab1',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('password');
  });

  it('rejects a password with no digit', async () => {
    const errors = await validateInput({
      email: 'alice@example.com',
      password: 'onlyletters',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('password');
  });

  it('rejects a password with no letter', async () => {
    const errors = await validateInput({
      email: 'alice@example.com',
      password: '12345678',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('password');
  });
});
