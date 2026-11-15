/** Goal: Run the E2E suite against a local production build, or any deployed URL passed as BASE_URL. */
import { defineConfig, devices } from "@playwright/test";

// Set BASE_URL to test a container or preview; leave it unset to build and serve the app here
const remoteBaseURL = process.env.BASE_URL;
const localBaseURL = "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A test that only passes on retry is a failure worth seeing
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: remoteBaseURL ?? localBaseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: remoteBaseURL
    ? undefined
    : {
      // Production build, so local runs match what the container will serve
      command: "npm run build && npm run start",
      url: `${localBaseURL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
});
