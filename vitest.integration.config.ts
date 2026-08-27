import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Integrációs tesztek: valódi (eldobható) Postgres teszt-DB ellen futnak.
 * Felépítés: npm run test:integration:setup · futtatás: npm run test:integration
 * Részletek: docs/INTEGRATION_TESTS.md
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/integration/**/*.test.ts'],
    setupFiles: ['__tests__/integration/setup-env.ts'],
    globalSetup: ['__tests__/integration/global-setup.ts'],
    // Egy szálon futtatjuk a fájlokat: közös DB-n a párhuzamos suite-ok
    // egymás adatait zavarnák.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
