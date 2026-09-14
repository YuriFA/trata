import { defineConfig } from 'vitest/config'

// Node-only: the money package is platform-agnostic (no DOM, no React Native).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
