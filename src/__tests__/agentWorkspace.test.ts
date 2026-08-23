import { describe, expect, it } from "vitest";

import { AGENT_WORKSPACE_LIMITS } from "../config/limits";
import {
  applyWorkspaceEdit,
  getSessionWorkspaceRoot,
  guessWorkspaceMimeType,
  isTextWorkspaceFile,
  normalizeWorkspacePath,
  resolveWorkspaceUrl,
  sliceWorkspaceLines,
  toArchiveFileName,
  toWorkspaceRelativePath,
  toWorkspaceUploadPath,
} from "../lib/agent/workspace";

const SESSION = "0192f0a1-1111-7000-8000-abcdefabcdef";

describe("workspace path safety", () => {
  it("scopes resolved URLs to the session root", () => {
    const resolved = resolveWorkspaceUrl(SESSION, "reports/summary.md");

    expect(resolved).toEqual({
      ok: true,
      value: {
        path: "reports/summary.md",
        url: `opfs://chat/workspace/${SESSION}/reports/summary.md`,
      },
    });
  });

  it.each([
    ["parent traversal", "../secrets.txt"],
    ["nested traversal", "reports/../../knowledge-base/a.txt"],
    ["absolute path", "/etc/passwd"],
    ["backslash separator", "reports\\summary.md"],
    ["null byte", "report\u0000.md"],
    ["control character", "report\u0007.md"],
    ["empty segment", "reports//summary.md"],
    ["bare dot", "."],
    ["empty string", "   "],
  ])("rejects %s", (_label, path) => {
    const result = normalizeWorkspacePath(path);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WORKSPACE_INVALID_PATH");
  });

  it("rejects paths deeper than the depth limit", () => {
    const deep = Array.from(
      { length: AGENT_WORKSPACE_LIMITS.maxPathDepth + 1 },
      (_, index) => `d${index}`,
    ).join("/");

    expect(normalizeWorkspacePath(deep).ok).toBe(false);
  });

  it("rejects paths longer than the character limit", () => {
    const long = `${"a".repeat(AGENT_WORKSPACE_LIMITS.maxPathChars)}.txt`;

    expect(normalizeWorkspacePath(long).ok).toBe(false);
  });

  it("strips a leading ./ prefix", () => {
    expect(normalizeWorkspacePath("./data.csv")).toEqual({
      ok: true,
      value: "data.csv",
    });
  });

  it("accepts safe Unicode letters and numbers without weakening traversal checks", () => {
    expect(normalizeWorkspacePath("资料/報告-二〇二六.md")).toEqual({
      ok: true,
      value: "资料/報告-二〇二六.md",
    });
  });

  it("rejects unsafe session ids", () => {
    expect(getSessionWorkspaceRoot("../escape")).toBeNull();
    expect(getSessionWorkspaceRoot("")).toBeNull();
    expect(getSessionWorkspaceRoot(SESSION)).toBe(`chat/workspace/${SESSION}`);
  });

  it("reports an unavailable workspace for an unsafe session id", () => {
    const result = resolveWorkspaceUrl("../escape", "a.txt");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WORKSPACE_UNAVAILABLE");
  });

  it("round-trips absolute OPFS paths back to relative paths", () => {
    expect(
      toWorkspaceRelativePath(SESSION, `chat/workspace/${SESSION}/a/b.txt`),
    ).toBe("a/b.txt");
    expect(
      toWorkspaceRelativePath(SESSION, "chat/long-text/other.md"),
    ).toBeNull();
  });
});

describe("workspace mime types", () => {
  it("maps known extensions and defaults to plain text", () => {
    expect(guessWorkspaceMimeType("a/b.csv")).toBe("text/csv");
    expect(guessWorkspaceMimeType("notes.md")).toBe("text/markdown");
    expect(guessWorkspaceMimeType("chart.png")).toBe("image/png");
    expect(guessWorkspaceMimeType("noextension")).toBe("text/plain");
  });

  it("classifies text and binary files", () => {
    expect(isTextWorkspaceFile("data.json")).toBe(true);
    expect(isTextWorkspaceFile("chart.png")).toBe(false);
  });
});

describe("applyWorkspaceEdit", () => {
  it("replaces a single unambiguous match", () => {
    expect(applyWorkspaceEdit("hello world", "world", "there")).toEqual({
      ok: true,
      value: { content: "hello there", replacements: 1 },
    });
  });

  it("refuses an ambiguous match unless replaceAll is set", () => {
    const ambiguous = applyWorkspaceEdit("a a", "a", "b");
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.error.code).toBe("WORKSPACE_EDIT_AMBIGUOUS");
    }

    expect(applyWorkspaceEdit("a a", "a", "b", true)).toEqual({
      ok: true,
      value: { content: "b b", replacements: 2 },
    });
  });

  it("reports a missing match", () => {
    const result = applyWorkspaceEdit("hello", "absent", "x");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WORKSPACE_EDIT_NO_MATCH");
  });

  it("rejects empty and no-op edits", () => {
    expect(applyWorkspaceEdit("hello", "", "x").ok).toBe(false);
    expect(applyWorkspaceEdit("hello", "hello", "hello").ok).toBe(false);
  });
});

describe("sliceWorkspaceLines", () => {
  const content = ["one", "two", "three", "four"].join("\n");

  it("returns the whole file untruncated by default", () => {
    expect(sliceWorkspaceLines(content)).toEqual({
      content,
      totalLines: 4,
      startLine: 0,
      truncated: false,
    });
  });

  it("returns a line window and flags truncation", () => {
    expect(sliceWorkspaceLines(content, 1, 2)).toEqual({
      content: "two\nthree",
      totalLines: 4,
      startLine: 1,
      truncated: true,
    });
  });

  it("caps the returned characters", () => {
    const huge = "x".repeat(AGENT_WORKSPACE_LIMITS.maxReadChars + 100);
    const slice = sliceWorkspaceLines(huge);

    expect(slice.content).toHaveLength(AGENT_WORKSPACE_LIMITS.maxReadChars);
    expect(slice.truncated).toBe(true);
  });
});

describe("toWorkspaceUploadPath", () => {
  it("places a clean file name under uploads/", () => {
    expect(toWorkspaceUploadPath("data.csv")).toBe("uploads/data.csv");
  });

  it("strips directory components from a hostile name", () => {
    expect(toWorkspaceUploadPath("../../etc/passwd")).toBe("uploads/passwd");
    expect(toWorkspaceUploadPath("C:\\Users\\me\\notes.md")).toBe(
      "uploads/notes.md",
    );
  });

  it("replaces unsafe characters rather than passing them through", () => {
    expect(toWorkspaceUploadPath("my report (final).txt")).toBe(
      "uploads/my-report-final-.txt",
    );
  });

  it("preserves localized names and their file extensions", () => {
    expect(toWorkspaceUploadPath("报告.pdf")).toBe("uploads/报告.pdf");
    expect(toWorkspaceUploadPath("解析結果.json")).toBe(
      "uploads/解析結果.json",
    );
    expect(toWorkspaceUploadPath("会议记录")).toBe("uploads/会议记录");
  });

  it("preserves the extension when truncating a long localized name", () => {
    const path = toWorkspaceUploadPath(`${"报告".repeat(60)}.pdf`);

    expect(path?.endsWith(".pdf")).toBe(true);
    expect(path?.slice("uploads/".length)).toHaveLength(80);
  });

  it("rejects names that sanitise down to nothing", () => {
    expect(toWorkspaceUploadPath("...")).toBeNull();
    expect(toWorkspaceUploadPath("")).toBeNull();
    expect(toWorkspaceUploadPath("/")).toBeNull();
  });
});

describe("toArchiveFileName", () => {
  it("preserves a safe localized download name", () => {
    expect(toArchiveFileName("分析结果")).toBe("分析结果.zip");
  });
});
