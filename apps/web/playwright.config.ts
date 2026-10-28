import { defineConfig, devices } from '@playwright/test'

const serverPort = process.env.E2E_SERVER_PORT ?? '3001'
const webPort = process.env.E2E_WEB_PORT ?? '5173'
const serverUrl = `http://127.0.0.1:${serverPort}`
const webUrl = `http://127.0.0.1:${webPort}`

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 375, height: 812 },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @unfold/server dev',
      url: `${serverUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        MODEL_MODE: 'mock',
        NODE_ENV: 'test',
        PORT: serverPort,
        DATABASE_URL:
          process.env.DATABASE_URL_TEST ??
          'mysql://unfold:unfold@localhost:3306/unfold_test',
      },
    },
    {
      command: 'pnpm dev',
      url: webUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        E2E_SERVER_URL: serverUrl,
        E2E_WEB_PORT: webPort,
      },
    },
  ],
})
