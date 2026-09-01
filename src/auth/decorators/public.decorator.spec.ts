import { describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY, Public } from './public.decorator.js';

describe('Public decorator', () => {
  it('attaches isPublic=true metadata to the decorated handler', () => {
    class Fixture {
      @Public()
      handler() {}
    }

    const metadata = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      Fixture.prototype.handler,
    );

    expect(metadata).toBe(true);
  });

  it('leaves an undecorated handler without isPublic metadata', () => {
    class Fixture {
      handler() {}
    }

    const metadata = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      Fixture.prototype.handler,
    );

    expect(metadata).toBeUndefined();
  });
});
