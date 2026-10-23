import { defineConfig } from '@playwright/test'
import { BASE_URL, DEV_PORT, TEST_API } from './e2e/env'

// Runs against the test backend (see e2e/env.ts and the README) through a Vite dev server of its own.
export default defineConfig({
  testDir: './e2e',
  // Specs share seed accounts and the one-session-per-user rule, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    // Use the Edge that ships with Windows; no browser download needed.
    channel: 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    // Only ever a server on the test port: the everyday one on 5173 talks to the demo backend.
    reuseExistingServer: true,
    timeout: 60_000,
    env: { API_TARGET: TEST_API, DEV_PORT: String(DEV_PORT) },
  },
})
