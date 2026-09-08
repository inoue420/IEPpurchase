import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/firestore/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
})
