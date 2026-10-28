import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const webPort = Number(process.env.E2E_WEB_PORT ?? 5173)
const serverUrl = process.env.E2E_SERVER_URL ?? 'http://localhost:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: webPort,
    proxy: {
      '/trpc': serverUrl,
      '/health': serverUrl,
    },
  },
  preview: {
    proxy: {
      '/trpc': serverUrl,
      '/health': serverUrl,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/test/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
