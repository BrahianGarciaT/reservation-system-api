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
  },
});
