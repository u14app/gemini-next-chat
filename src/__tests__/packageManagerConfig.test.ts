import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("package manager configuration", () => {
  it("keeps pnpm overrides in the workspace manifest used by current pnpm", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { pnpm?: { overrides?: Record<string, string> } };
    const workspaceYaml = readFileSync(
      resolve(process.cwd(), "pnpm-workspace.yaml"),
      "utf8",
    );

    expect(packageJson.pnpm?.overrides).toBeUndefined();
    expect(workspaceYaml).toContain("overrides:");
    expect(workspaceYaml).toMatch(/["']ws@>=8\.0\.0 <8\.20\.1["']: 8\.21\.0/);
    for (const override of [
      '"@hono/node-server": 1.19.15',
      "browserslist: 4.28.7",
      "dompurify: 3.4.14",
      "fast-uri: 3.1.6",
      "hono: 4.13.7",
      "ip-address: 10.7.0",
      "protobufjs: 7.6.5",
      "qs: 6.16.0",
    ]) {
      expect(workspaceYaml).toContain(override);
    }
    expect(workspaceYaml).not.toContain("set this to true or false");
    expect(workspaceYaml).toContain("minimumReleaseAge: 0");
    expect(workspaceYaml).toContain("verifyDepsBeforeRun: false");
  });
});
