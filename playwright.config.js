import { defineConfig, devices } from '@playwright/test';

/* End-to-end suite: a real browser against the Vite dev server and the local Supabase stack (`supabase start`).
   Run it with `npm run test:e2e`. When the local Supabase is not reachable every test is skipped with a clear message (see tests/e2e/global-setup.js).

   Port: 4180, a dedicated one (5173 is the developer's server and 4173 is used for previews, so both are left alone). The local Supabase
   only lists ports 5173 and 4173 in supabase/config.toml, but its auth accepts any port on localhost as a redirect target (checked: a link
   asking for http://localhost:4180/ redirects there, one asking for another host falls back to site_url). The helpers in tests/e2e/helpers.js
   keep only the path and fragment of e-mail links anyway, so they would work on any port. Override with E2E_PORT if 4180 is busy. */
const PORT = Number(process.env.E2E_PORT || 4180);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
  outputDir: 'test-results',
  // the specs share one local database and the auth service rate-limits sign-ins per IP
  workers: 1,
  fullyParallel: false,
  retries: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  globalSetup: './tests/e2e/global-setup.js',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npx vite --config tests/e2e/vite.config.js --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { E2E_PORT: String(PORT) },
  },
});
