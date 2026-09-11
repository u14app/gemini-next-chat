import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

const ENV_FILES = [
  ".env.example",
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  ".env.production",
  ".env.production.local",
];

/** Only the Playwright-managed server receives these fixture settings. */
export function createE2EServerEnvironment(
  projectDirectory: string,
  baseURL: string,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of ENV_FILES) {
    const path = join(projectDirectory, name);
    if (!existsSync(path)) continue;
    // Empty values prevent Next from loading a developer's deployment settings
    // again. Values are never copied into the test environment or reported.
    for (const key of Object.keys(parseEnv(readFileSync(path, "utf8")))) {
      environment[key] = "";
    }
  }

  return {
    ...environment,
    NODE_ENV: "development",
    NEO_CHAT_E2E: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    DEPLOYMENT_MODE: "local",
    ACCESS_PASSWORD: "",
    BYOK_ALLOW_EPHEMERAL_KEY: "true",
    RATE_LIMIT_STORE: "memory",
    DOCUMENT_PARSE_JOB_STORE: "memory",
    PLUGIN_REGISTRY_STORE: "memory",
    SHARING_ENABLED: "false",
    NEXT_PUBLIC_SITE_URL: baseURL,
    NEXT_PUBLIC_API_URL: "",
  };
}
