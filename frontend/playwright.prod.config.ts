import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * The same tests, against the built app served by the TEST stack's Nginx on port 8081 (see the README), with
 * frontend/dist built (`npm run build`). Nothing is started for you. Run it with `npm run test:e2e:prod`.
 */
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8081' },
  webServer: undefined,
})
