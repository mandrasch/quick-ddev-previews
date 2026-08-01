import { defineConfig } from 'vitest/config'

// The e2e suite drives a RUNNING instance over HTTP. Set
// QUICKDDEVPREVIEWS_E2E_BASE_URL to point it at one.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // Scenarios share one instance; keep files strictly sequential.
    fileParallelism: false,
  },
})
