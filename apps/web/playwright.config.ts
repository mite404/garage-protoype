import { defineConfig, devices } from "@playwright/test";

// The harness serves `next start`, so run `npm run build` first. Set
// PLAYWRIGHT_CHROMIUM_EXECUTABLE to reuse a local Chrome, and E2E_SLOWMO (ms) to pace a
// recording for human review.
const port = Number(process.env.E2E_PORT ?? 3919);
const baseURL = `http://127.0.0.1:${port}`;
const slowMo = Number(process.env.E2E_SLOWMO ?? 0);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    storageState: ".e2e/storage-state.json",
    viewport: { width: 1440, height: 900 },
    video: { mode: "on", size: { width: 1440, height: 900 } },
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    launchOptions: { slowMo, executablePath },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "node --conditions=react-server --import tsx e2e/harness.ts",
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      E2E_PORT: String(port),
      TSX_TSCONFIG_PATH: "tsconfig.json",
      POSTHOG_ENABLED: "false",
      NEXT_PUBLIC_POSTHOG_ENABLED: "false",
    },
  },
});
