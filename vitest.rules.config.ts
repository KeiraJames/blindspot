import { defineConfig } from 'vitest/config';

// Security rules tests. Run with the emulator: `npm run test:rules` (needs Java 21+ and firebase-tools).
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    fileParallelism: false,
  },
});
