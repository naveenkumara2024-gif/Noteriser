import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

// The app runs in fake mode (scripted models, in-memory store): deterministic, no keys, no downloads.
// FAKE_DELAY_MS slows each scripted model call a little so the progress panel can be seen and cancelled.
// It builds first, so stop any `npm run dev` before running this (both use the .next folder).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { LLM_MODE: "fake", RATE_LIMIT_RUNS: "1000", FAKE_DELAY_MS: "120" },
  },
});
