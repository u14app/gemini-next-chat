import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createE2EServerEnvironment } from "../../e2e/serverEnvironment";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Playwright-managed server environment", () => {
  it("overrides deployment settings without changing developer env files", () => {
    const directory = mkdtempSync(join(tmpdir(), "neo-e2e-env-"));
    directories.push(directory);
    const source = [
      "ACCESS_PASSWORD=fixture-password",
      "DEPLOYMENT_MODE=hosted",
      "RATE_LIMIT_STORE=upstash",
      "UPSTASH_REDIS_REST_URL=https://redis.example.test",
      "UPSTASH_REDIS_REST_TOKEN=fixture-token",
      "DEFAULT_PROVIDER_API_KEY=fixture-provider-key",
      "NEXT_PUBLIC_API_URL=https://api.example.test",
      'export CUSTOM_LOCAL_SETTING="fixture value"',
    ].join("\n");
    const envPath = join(directory, ".env.local");
    writeFileSync(envPath, source);
    writeFileSync(
      join(directory, ".env.example"),
      "DEFAULT_SEARCH_API_KEY=\nBYOK_PRIVATE_KEY_PEM=\n",
    );

    const environment = createE2EServerEnvironment(
      directory,
      "http://127.0.0.1:3200",
    );
    expect(environment).toMatchObject({
      NODE_ENV: "development",
      NEO_CHAT_E2E: "1",
      ACCESS_PASSWORD: "",
      DEPLOYMENT_MODE: "local",
      RATE_LIMIT_STORE: "memory",
      DOCUMENT_PARSE_JOB_STORE: "memory",
      PLUGIN_REGISTRY_STORE: "memory",
      SHARING_ENABLED: "false",
      BYOK_ALLOW_EPHEMERAL_KEY: "true",
      BYOK_PRIVATE_KEY_PEM: "",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      DEFAULT_PROVIDER_API_KEY: "",
      DEFAULT_SEARCH_API_KEY: "",
      NEXT_PUBLIC_API_URL: "",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3200",
      CUSTOM_LOCAL_SETTING: "",
    });
    expect(readFileSync(envPath, "utf8")).toBe(source);
    expect(environment).not.toHaveProperty("PATH");
  });

  it("works in a clean checkout without developer env files", () => {
    const directory = mkdtempSync(join(tmpdir(), "neo-e2e-env-"));
    directories.push(directory);
    expect(
      createE2EServerEnvironment(directory, "http://127.0.0.1:3100"),
    ).toMatchObject({
      ACCESS_PASSWORD: "",
      DEPLOYMENT_MODE: "local",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
    });
  });
});
