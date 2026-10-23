import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/**
 * The backend the dev server talks to: the demo stack on port 80 by default. Playwright starts its own dev server
 * (port 5174) aimed at the separate test backend on 8081, so tests never touch the demo data.
 */
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:80'
const PORT = Number(process.env.DEV_PORT ?? 5173)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: PORT,
    strictPort: true,
    // Build and test output must never trigger hot updates in open pages.
    watch: {
      ignored: ['**/dist/**', '**/test-results/**', '**/playwright-report/**', '**/e2e/**'],
    },
    // One origin for the browser: cookies and WebSockets just work.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
