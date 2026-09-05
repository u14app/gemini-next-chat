import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResearchWorkspaceUnavailableError } from "@/lib/research/runtime/dependencyErrors";

const mocks = vi.hoisted(() => ({
  listWorkspace: vi.fn(),
}));

vi.mock("@/services/workspace/sessionWorkspace", () => ({
  listWorkspace: mocks.listWorkspace,
}));

import { captureApprovedWorkspaceSources } from "@/lib/research/runtime/sourceSnapshot";

beforeEach(() => {
  mocks.listWorkspace.mockReset();
});

describe("approved Research workspace snapshots", () => {
  it("returns an empty scope when workspace tools are not approved", async () => {
    await expect(
      captureApprovedWorkspaceSources("session", ["web_search"]),
    ).resolves.toEqual([]);
    expect(mocks.listWorkspace).not.toHaveBeenCalled();
  });

  it("preserves an empty workspace as a successful empty scope", async () => {
    mocks.listWorkspace.mockResolvedValue({
      ok: true,
      value: { files: [], usage: {}, truncated: false },
    });

    await expect(
      captureApprovedWorkspaceSources("session", ["read_workspace_file"]),
    ).resolves.toEqual([]);
  });

  it.each([
    ["returned failure", { ok: false, error: { message: "OPFS unavailable" } }],
    ["rejected read", new Error("OPFS read failed")],
  ])(
    "surfaces a %s instead of silently narrowing source scope",
    async (_, failure) => {
      if (failure instanceof Error) {
        mocks.listWorkspace.mockRejectedValue(failure);
      } else {
        mocks.listWorkspace.mockResolvedValue(failure);
      }

      await expect(
        captureApprovedWorkspaceSources("session", ["read_workspace_file"]),
      ).rejects.toBeInstanceOf(ResearchWorkspaceUnavailableError);
    },
  );
});
