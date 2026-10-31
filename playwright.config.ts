import { defineConfig, devices } from "@playwright/test";

// End-to-end tests: the built app served by the real server in a real (mobile) Chromium.
// Every test gets its own server process and database (see e2e/fixtures.ts), so tests are independent
// and can run in parallel. `globalSetup` builds the app once.
export default defineConfig({
    testDir: "e2e",
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
    globalSetup: "./e2e/globalSetup.ts",
    outputDir: "test-results",
    timeout: 30_000,
    expect: { timeout: 7_000 },
    use: {
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
});
