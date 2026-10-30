/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'conformance/**/*.test.ts'],
    // UI tests opt into a DOM with a `// @vitest-environment jsdom` file comment.
    environment: 'node',
    // Export e2e tests spawn Python and editor/playground tests render large jsdom trees;
    // under a full parallel run these exceed the 5 s default.
    testTimeout: 30_000,
  },
});
