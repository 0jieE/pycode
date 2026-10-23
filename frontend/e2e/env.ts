/**
 * The tests run against the separate TEST backend (port 8081, its own database, accounts in
 * backend/e2e_credentials.txt), never the demo one on port 80.
 *
 * By default: a Vite dev server of their own on port 5174 that proxies /api to 8081 (the everyday dev server on
 * 5173 talks to the demo backend, so it is never reused). `npm run test:e2e:prod` instead looks at the built app
 * served by the test stack's Nginx on 8081.
 */
export const TEST_API = process.env.E2E_API ?? 'http://localhost:8081'
export const DEV_PORT = 5174
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${DEV_PORT}`
