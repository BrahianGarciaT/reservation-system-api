import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

export default defineConfig({
  // `unplugin-swc` emits real decorator metadata (`emitDecoratorMetadata`),
  // which esbuild (Vitest's default transform) does not support. Nest's
  // dependency injection relies on `design:paramtypes` metadata, so e2e
  // specs that bootstrap the real Nest app need this transform.
  plugins: [tsconfigPaths(), swc.vite()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Every e2e spec shares one real Postgres database and TRUNCATEs its
    // own tables between tests; running spec files in parallel workers lets
    // one file's TRUNCATE CASCADE race another file's in-flight assertions
    // (e.g. `resources.e2e-spec.ts`'s "resources" CASCADE would delete
    // in-flight `reservations.e2e-spec.ts` rows). Sequential file execution
    // keeps the shared-DB e2e specs deterministic, mirroring the unit/
    // integration config.
    fileParallelism: false,
  },
});
