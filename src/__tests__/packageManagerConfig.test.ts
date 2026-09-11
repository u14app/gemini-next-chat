import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("package manager configuration", () => {
  it("keeps pnpm overrides in the workspace manifest used by current pnpm", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as {
      devDependencies?: Record<string, string>;
      pnpm?: { overrides?: Record<string, string> };
    };
    const workspaceYaml = readFileSync(
      resolve(process.cwd(), "pnpm-workspace.yaml"),
      "utf8",
    );
    const bridgeWorkspaceYaml = readFileSync(
      resolve(process.cwd(), "docker/mcp-bridge/pnpm-workspace.yaml"),
      "utf8",
    );
    const bridgePackageJson = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "docker/mcp-bridge/package.json"),
        "utf8",
      ),
    ) as { packageManager?: string };
    const bridgeDockerfile = readFileSync(
      resolve(process.cwd(), "docker/mcp-bridge/Dockerfile"),
      "utf8",
    );
    const ciWorkflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(packageJson.pnpm?.overrides).toBeUndefined();
    expect(packageJson.devDependencies?.vitest).toBe("^4.1.11");
    expect(bridgePackageJson.packageManager).toBe("pnpm@10.30.3");
    expect(workspaceYaml).toContain("overrides:");
    expect(workspaceYaml).toMatch(/["']ws@>=8\.0\.0 <8\.20\.1["']: 8\.21\.0/);
    for (const override of [
      '"@hono/node-server": 1.19.15',
      '"baseline-browser-mapping@>=2.0.0 <2.11.0": 2.11.22',
      "browserslist: 4.28.7",
      '"brace-expansion@<1.1.18": 1.1.18',
      '"brace-expansion@>=2.0.0 <2.1.4": 2.1.4',
      '"brace-expansion@>=4.0.0 <5.0.9": 5.0.9',
      "dompurify: 3.4.14",
      "fast-uri: 3.1.6",
      "hono: 4.13.7",
      "ip-address: 10.7.0",
      '"js-yaml@>=4.0.0 <4.3.2": 4.3.2',
      "protobufjs: 7.6.5",
      "qs: 6.16.0",
      '"sharp@<0.35.4": 0.35.4',
    ]) {
      expect(workspaceYaml).toContain(override);
    }
    for (const override of [
      '"@hono/node-server": 1.19.15',
      "fast-uri: 3.1.6",
      "hono: 4.13.7",
      "ip-address: 10.7.0",
      "qs: 6.16.0",
    ]) {
      expect(bridgeWorkspaceYaml).toContain(override);
    }
    expect(bridgeDockerfile).toContain("docker/mcp-bridge/pnpm-workspace.yaml");
    expect(ciWorkflow).toContain("pnpm audit --audit-level moderate");
    expect(ciWorkflow).toContain("working-directory: docker/mcp-bridge");
    expect(ciWorkflow).toContain("pnpm audit --prod --audit-level moderate");
    expect(workspaceYaml).not.toContain("set this to true or false");
    expect(workspaceYaml).toContain("minimumReleaseAge: 0");
    expect(workspaceYaml).toContain("verifyDepsBeforeRun: false");
  });
});
