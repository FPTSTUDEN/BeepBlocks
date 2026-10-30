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
  },
});
