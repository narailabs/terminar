import { defineConfig, devices } from '@playwright/test';

// Use local-echo mode when LOCAL_ECHO env var is set (bypasses Rust server)
const useLocalEcho = process.env.LOCAL_ECHO === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  // Run tests serially - the terminal server has shared state
  // that causes race conditions when tests run in parallel
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    // Set localStorage for local-echo mode (app checks this as fallback)
    storageState: useLocalEcho ? {
      cookies: [],
      origins: [{
        origin: 'http://localhost:3001',
        localStorage: [{ name: 'local-echo', value: '1' }],
      }],
    } : undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
