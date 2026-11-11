import { defineConfig } from 'vitest/config';

/* Two projects:
   - unit         pure logic (mappers, sync engine with a fake client). No network, no DOM. `npm test`
   - integration  supabase-js against the local Supabase stack (RLS, triggers, RPCs, storage). `npm run test:integration`
                  Skipped with a clear message when the local API is not reachable. */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.js'],
          restoreMocks: true,
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.js'],
          globalSetup: ['tests/integration/global-setup.js'],
          // one worker at a time: the files share one database and the auth service rate-limits sign-ins
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 120000,
        },
      },
    ],
  },
});
