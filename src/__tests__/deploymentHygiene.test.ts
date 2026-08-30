import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("deployment hygiene", () => {
  it("keeps Worker build gates and Node version hints in project automation", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    );
    const ci = readFileSync(
      resolve(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );
    const nodeVersion = readFileSync(
      resolve(process.cwd(), ".node-version"),
      "utf8",
    ).trim();

    expect(nodeVersion).toBe("24");
    expect(packageJson.scripts["worker:size"]).toBe(
      "node scripts/check-worker-size.mjs",
    );
    expect(packageJson.scripts["worker:dry-run"]).toBe(
      "wrangler deploy --dry-run --config wrangler.jsonc",
    );
    expect(packageJson.scripts["hygiene:artifacts"]).toBe(
      "node scripts/check-artifacts.mjs",
    );
    expect(packageJson.scripts["check:imports"]).toBe(
      "node scripts/check-import-paths.mjs",
    );
    expect(ci).toContain("pnpm build:worker");
    expect(ci).toContain("pnpm worker:size");
    expect(ci).not.toContain("pnpm worker:dry-run");
    expect(ci).toContain("pnpm hygiene:artifacts");
    expect(ci).toContain("pnpm check:imports");
    expect(ci).toContain("pnpm audit --prod --audit-level moderate");
  });

  it("uses production-friendly Cloudflare observability sampling", () => {
    const wrangler = readFileSync(
      resolve(process.cwd(), "wrangler.jsonc"),
      "utf8",
    );

    expect(wrangler).toContain('"head_sampling_rate": 0.1');
    expect(wrangler).not.toContain('"head_sampling_rate": 1');
  });
});
