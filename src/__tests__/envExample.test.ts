import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REQUIRED_ENV_KEYS = [
  "ACCESS_PASSWORD",
  "BYOK_PRIVATE_KEY_PEM",
  "BYOK_KEY_ID",
  "BYOK_ALLOW_EPHEMERAL_KEY",
  "DEPLOYMENT_MODE",
  "NEXT_DEPLOYMENT_ID",
  "ALLOW_INSECURE_LOCAL_PRODUCTION",
  "ALLOW_LOCAL_NETWORK_PROXY",
  "TRUST_PROXY_HEADERS",
  "RATE_LIMIT_STORE",
  "DOCUMENT_PARSE_JOB_STORE",
  "PLUGIN_REGISTRY_STORE",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "SHARING_ENABLED",
  "MAX_ATTACHMENT_FILE_BYTES",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_API_URL",
  "DEFAULT_PROVIDER_TYPE",
  "DEFAULT_PROVIDER_NAME",
  "DEFAULT_PROVIDER_BASE_URL",
  "DEFAULT_PROVIDER_API_KEY",
  "DEFAULT_PROVIDER_MODELS",
  "DEFAULT_MODEL_TITLE_GENERATION",
  "DEFAULT_MODEL_RELATED_QUESTIONS",
  "DEFAULT_MODEL_CONTEXT_COMPRESSION",
  "DEFAULT_MODEL_PROMPT_OPTIMIZATION",
  "DEFAULT_MODEL_RAG_QUERY",
  "DEFAULT_MODEL_MEMORY",
  "DEFAULT_SEARCH_PROVIDER",
  "DEFAULT_SEARCH_API_KEY",
  "DEFAULT_SEARCH_BASE_URL",
  "DEFAULT_RAG_BASE_URL",
  "DEFAULT_RAG_TOKEN",
  "DEFAULT_RAG_TOP_K",
  "DEFAULT_RAG_CHUNK_SIZE",
  "DEFAULT_RAG_NAMESPACE",
  "DEFAULT_DOCUMENT_PARSE_PROVIDER",
  "DEFAULT_MINERU_API_TOKEN",
  "DEFAULT_LLAMA_PARSE_API_KEY",
  "DEFAULT_ELEVENLABS_API_KEY",
  "DEFAULT_ELEVENLABS_STT_MODEL",
  "DEFAULT_ELEVENLABS_TTS_MODEL",
  "DEFAULT_ELEVENLABS_TTS_VOICE_ID",
  "DEFAULT_VOICE_PROVIDER",
  "DEFAULT_MIMO_API_KEY",
  "DEFAULT_MIMO_STT_MODEL",
  "DEFAULT_MIMO_TTS_MODEL",
  "DEFAULT_MIMO_TTS_VOICE_ID",
  "DEFAULT_SYSTEM_PROMPT",
  "DEFAULT_ENABLE_AUTO_TITLE",
  "DEFAULT_ENABLE_RELATED_QUESTIONS",
  "DEFAULT_ENABLE_AUTO_COMPRESSION",
  "DEFAULT_COMPRESSION_THRESHOLD",
  "DEFAULT_HISTORY_KEEP_COUNT",
  "DEFAULT_ENABLE_CODE_COLLAPSE",
  "DEFAULT_ENABLE_HTML_VISUAL_PROMPT",
] as const;

function parseEnvExampleKeys(): Set<string> {
  const text = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
  return new Set(
    text
      .split("\n")
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter((key): key is string => Boolean(key)),
  );
}

function scanDirectProcessEnvKeys(): Set<string> {
  const files = [
    "next.config.ts",
    "src/lib/byok/server.ts",
    "src/lib/defaultConfig/server.ts",
    "src/lib/security/accessControl.ts",
    "src/lib/security/deployment.ts",
    "src/lib/security/requestGuards.ts",
    "src/lib/security/requestProof.ts",
    "src/lib/security/rateLimitStore.ts",
    "src/lib/sharing/config.ts",
    "src/lib/plugin/serverRegistry.ts",
    "src/lib/api/docParseJobs.ts",
    "src/lib/seo.ts",
    "src/config/api.ts",
  ];
  const keys = new Set<string>();
  const directEnvPattern = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  const quotedEnvPattern =
    /(?:env|getEnvValue)\(\s*["']([A-Z][A-Z0-9_]*)["']\s*\)/g;

  for (const file of files) {
    const text = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const match of text.matchAll(directEnvPattern)) keys.add(match[1]);
    for (const match of text.matchAll(quotedEnvPattern)) keys.add(match[1]);
  }

  keys.delete("NODE_ENV");
  // Playwright sets this internal dev-server flag; it is not deployment config.
  keys.delete("NEO_CHAT_E2E");
  return keys;
}

function parseWranglerConfig(): Record<string, unknown> {
  const text = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
  const withoutLineComments = text.replace(/^\s*\/\/.*$/gm, "");
  const withoutTrailingCommas = withoutLineComments.replace(
    /,\s*([}\]])/g,
    "$1",
  );
  return JSON.parse(withoutTrailingCommas) as Record<string, unknown>;
}

describe(".env.example", () => {
  it("documents every maintained application environment variable", () => {
    const exampleKeys = parseEnvExampleKeys();
    const documentedKeys = new Set<string>([...REQUIRED_ENV_KEYS]);

    expect([...documentedKeys].filter((key) => !exampleKeys.has(key))).toEqual(
      [],
    );
    expect([...exampleKeys].filter((key) => !documentedKeys.has(key))).toEqual(
      [],
    );
  });

  it("does not drift from direct process.env usage", () => {
    const exampleKeys = parseEnvExampleKeys();
    const codeKeys = scanDirectProcessEnvKeys();

    expect([...codeKeys].filter((key) => !exampleKeys.has(key))).toEqual([]);
  });

  it("keeps Docker Compose aligned with deployment store and proxy variables", () => {
    const compose = readFileSync(
      resolve(process.cwd(), "docker-compose.yml"),
      "utf8",
    );

    for (const key of [
      "NEXT_DEPLOYMENT_ID",
      "ALLOW_INSECURE_LOCAL_PRODUCTION",
      "ALLOW_LOCAL_NETWORK_PROXY",
      "TRUST_PROXY_HEADERS",
      "RATE_LIMIT_STORE",
      "DOCUMENT_PARSE_JOB_STORE",
      "PLUGIN_REGISTRY_STORE",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "SHARING_ENABLED",
    ]) {
      expect(compose).toContain(`${key}:`);
    }
  });

  it("keeps the Docker quick start fail-closed and checks API readiness", () => {
    const compose = readFileSync(
      resolve(process.cwd(), "docker-compose.yml"),
      "utf8",
    );

    expect(compose).toContain(
      "ACCESS_PASSWORD: ${ACCESS_PASSWORD:?Set ACCESS_PASSWORD before starting Neo Chat}",
    );
    expect(compose).toContain("http://127.0.0.1:3000/api/health");
    expect(compose).toContain("[200, 401].includes(response.status)");
  });

  it("keeps Cloudflare dashboard variables during Worker deploys", () => {
    const config = parseWranglerConfig();
    const vars = config.vars as Record<string, unknown> | undefined;

    expect(config.keep_vars).toBe(true);
    expect(vars?.keep_vars).toBeUndefined();
    expect(vars?.DEPLOYMENT_MODE).toBe("hosted");
  });

  it("keeps copied local defaults fail-closed for proxy identity", () => {
    const example = readFileSync(
      resolve(process.cwd(), ".env.example"),
      "utf8",
    );

    expect(example).toContain('TRUST_PROXY_HEADERS="false"');
  });
});
