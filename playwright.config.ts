import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./benchmarks",
  testMatch: "**/*.perf.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: ".performance-artifacts/results",
  reporter: [["list"], ["json", { outputFile: ".performance-artifacts/results.json" }]],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    baseURL: "http://127.0.0.1:4179",
    // Whole-DOM tracing changes the latency being measured.
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4179 --strictPort",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: false,
  },
});
