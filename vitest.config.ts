import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Next.js-hez igazodó automatic JSX runtime — a komponensek nem importálnak React-et.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['**/*.test.{ts,tsx}'],
    // Az integrációs tesztek külön configgal és valódi DB-vel futnak:
    // vitest.integration.config.ts (npm run test:integration).
    exclude: [...configDefaults.exclude, '__tests__/integration/**'],
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
