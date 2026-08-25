import { describe, expect, it } from "vitest";

import { getWorkspaceToolPresentation } from "@/lib/utils/workspaceToolPresentation";

describe("workspace Tool presentation", () => {
  it("keeps a bounded write snapshot with stable file identity", () => {
    const content = Array.from(
      { length: 20 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    const presentation = getWorkspaceToolPresentation({
      name: "write_workspace_file",
      args: { path: "reports/final.md", mode: "create", content },
      result: {
        ok: true,
        path: "reports/final.md",
        bytes: 151,
        revision: "sha256:1234567890abcdef",
      },
    });

    expect(presentation).toMatchObject({
      target: "reports/final.md",
      bytes: 151,
      revision: "sha256:1234567890abcdef",
      mode: "create",
    });
    expect(presentation?.previews[0]).toMatchObject({
      kind: "content",
      truncated: true,
    });
    expect(presentation?.previews[0].text).toContain("line 12");
    expect(presentation?.previews[0].text).not.toContain("line 13");
  });

  it("shows before and after fragments for an edit", () => {
    const presentation = getWorkspaceToolPresentation({
      name: "edit_workspace_file",
      args: {
        path: "notes.md",
        oldString: "old heading",
        newString: "new heading",
      },
      result: {
        ok: true,
        entry: {
          path: "notes.md",
          bytes: 42,
          revision: "sha256:edited",
        },
        replacements: 1,
      },
    });

    expect(presentation).toMatchObject({
      target: "notes.md",
      bytes: 42,
      revision: "sha256:edited",
      replacements: 1,
      previews: [
        { kind: "before", text: "old heading", truncated: false },
        { kind: "after", text: "new heading", truncated: false },
      ],
    });
  });

  it("summarizes every patch from the persisted arguments", () => {
    const presentation = getWorkspaceToolPresentation({
      name: "apply_workspace_patch",
      args: {
        path: "plan.md",
        patches: [
          { oldString: "alpha", newString: "beta" },
          { oldString: "one", newString: "two" },
        ],
      },
      result: {
        ok: true,
        entry: { path: "plan.md", revision: "sha256:patch" },
        replacements: 2,
      },
    });

    expect(presentation?.previews).toEqual([
      { kind: "before", text: "1. alpha\n2. one", truncated: false },
      { kind: "after", text: "1. beta\n2. two", truncated: false },
    ]);
  });

  it("reads content from a persisted Tool result envelope", () => {
    const presentation = getWorkspaceToolPresentation({
      name: "read_workspace_file",
      args: { path: "notes.md" },
      result: {
        ok: true,
        trust: "internal",
        provenance: {
          origin: "builtin",
          toolName: "read_workspace_file",
        },
        data: {
          path: "notes.md",
          revision: "sha256:read",
          content: "historical content",
        },
      },
    });

    expect(presentation?.target).toBe("notes.md");
    expect(presentation?.previews[0]).toEqual({
      kind: "content",
      text: "historical content",
      truncated: false,
    });
  });

  it("leaves non-workspace tools on the generic renderer", () => {
    expect(
      getWorkspaceToolPresentation({
        name: "web_search",
        args: { query: "release" },
        result: { ok: true },
      }),
    ).toBeNull();
  });
});
