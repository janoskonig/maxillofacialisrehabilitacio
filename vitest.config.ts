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
    // A .claude/** kizárás a párhuzamos agent-worktree-k tesztmásolatai ellen
    // kell (.claude/worktrees/<agent>/__tests__/... különben ide is beszámítana).
    exclude: [...configDefaults.exclude, '__tests__/integration/**', '.claude/**'],
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
