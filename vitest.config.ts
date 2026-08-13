import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Next.js-hez igazodó automatic JSX runtime — a komponensek nem importálnak React-et.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['**/*.test.{ts,tsx}'],
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
