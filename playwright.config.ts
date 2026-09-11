import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { createE2EServerEnvironment } from "./e2e/serverEnvironment";

const portValue = process.env.NEO_CHAT_E2E_PORT ?? "3100";
if (!/^\d+$/.test(portValue)) {
  throw new Error("NEO_CHAT_E2E_PORT must be a valid TCP port.");
}

const port = Number(portValue);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("NEO_CHAT_E2E_PORT must be between 1 and 65535.");
}

const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `corepack pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
    env: createE2EServerEnvironment(
      fileURLToPath(new URL(".", import.meta.url)),
      baseURL,
    ),
    url: baseURL,
    reuseExistingServer: process.env.NEO_CHAT_E2E_REUSE_EXISTING_SERVER === "1",
    timeout: 120_000,
  },
});
