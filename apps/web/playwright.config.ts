import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:5173',
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
      command:
        "bash -c 'source ~/.nvm/nvm.sh && pnpm --filter @unfold/server dev'",
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        MODEL_MODE: 'mock',
        NODE_ENV: 'test',
        PORT: '3001',
        DATABASE_URL:
          process.env.DATABASE_URL_TEST ??
          'mysql://unfold:unfold@localhost:3306/unfold_test',
      },
    },
    {
      command: "bash -c 'source ~/.nvm/nvm.sh && pnpm dev'",
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
