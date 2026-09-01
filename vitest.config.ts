import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Integration specs share one real Postgres `users` table and TRUNCATE
    // it between tests; running spec files in parallel workers lets one
    // file's TRUNCATE race another file's in-flight assertions. Sequential
    // file execution keeps the shared-DB integration specs deterministic.
    fileParallelism: false,
  },
});
