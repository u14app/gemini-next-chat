import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_WORKSPACE_LIMITS,
  BROWSER_SANDBOX_LIMITS,
} from "../config/limits";

const mocks = vi.hoisted(() => ({
  runInSandbox: vi.fn(),
  readWorkspaceBlob: vi.fn(),
  writeWorkspaceText: vi.fn(),
}));

vi.mock("../utils/sandbox", () => ({
  runInSandbox: mocks.runInSandbox,
}));

vi.mock("../services/workspace/sessionWorkspace", () => ({
  readWorkspaceBlob: mocks.readWorkspaceBlob,
  writeWorkspaceText: mocks.writeWorkspaceText,
}));

import { createJavaScriptBinding } from "../services/api/chat/builtinTools/javascript";

const context = {
  sessionId: "session-1",
  emit: {},
};

const sandboxResult = (output: string, files: Record<string, string> = {}) => ({
  output,
  files,
});

describe("run_javascript built-in", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.readWorkspaceBlob.mockImplementation(async (_session, path) => ({
      ok: true,
      value: {
        entry: { path },
        blob: new Blob([`content of ${path}`]),
      },
    }));
    mocks.writeWorkspaceText.mockImplementation(async (_session, path) => ({
      ok: true,
      value: { path },
    }));
  });

  it("executes bounded code with the request signal", async () => {
    const controller = new AbortController();
    mocks.runInSandbox.mockResolvedValue(sandboxResult("42"));

    const result = await createJavaScriptBinding().execute(
      { code: "return 6 * 7;" },
      { ...context, signal: controller.signal },
    );

    expect(mocks.runInSandbox).toHaveBeenCalledWith(
      "return 6 * 7;",
      controller.signal,
      { files: {}, captureFiles: false },
    );
    expect(result).toEqual({ output: "42" });
  });

  it("maps sandbox error strings to structured tool errors", async () => {
    mocks.runInSandbox.mockResolvedValue(sandboxResult("log\nError: broken"));

    await expect(
      createJavaScriptBinding().execute(
        { code: "throw Error('broken')" },
        context,
      ),
    ).resolves.toMatchObject({
      error: { code: "JAVASCRIPT_EXECUTION_FAILED" },
    });
  });

  it("rejects oversize code before creating a sandbox", async () => {
    const result = await createJavaScriptBinding().execute(
      { code: "x".repeat(BROWSER_SANDBOX_LIMITS.maxCodeChars + 1) },
      context,
    );

    expect(result).toMatchObject({
      error: { code: "JAVASCRIPT_CODE_TOO_LARGE" },
    });
    expect(mocks.runInSandbox).not.toHaveBeenCalled();
  });

  it("propagates request cancellation", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createJavaScriptBinding().execute(
        { code: "return 1;" },
        { ...context, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.runInSandbox).not.toHaveBeenCalled();
  });

  it("injects requested workspace files into the sandbox", async () => {
    mocks.runInSandbox.mockResolvedValue(sandboxResult("done"));

    await createJavaScriptBinding().execute(
      { code: "return files['data.csv'].length;", readFiles: ["data.csv"] },
      context,
    );

    expect(mocks.runInSandbox).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      { files: { "data.csv": "content of data.csv" }, captureFiles: false },
    );
  });

  it("surfaces a workspace read failure without running code", async () => {
    mocks.readWorkspaceBlob.mockResolvedValue({
      ok: false,
      error: { code: "WORKSPACE_FILE_NOT_FOUND", message: "missing" },
    });

    const result = await createJavaScriptBinding().execute(
      { code: "return 1;", readFiles: ["absent.csv"] },
      context,
    );

    expect(result).toMatchObject({
      error: { code: "WORKSPACE_FILE_NOT_FOUND" },
    });
    expect(mocks.runInSandbox).not.toHaveBeenCalled();
  });

  it("rejects more read files than the per-run limit", async () => {
    const paths = Array.from(
      { length: AGENT_WORKSPACE_LIMITS.maxSandboxReadFiles + 1 },
      (_, index) => `f${index}.txt`,
    );

    const result = await createJavaScriptBinding().execute(
      { code: "return 1;", readFiles: paths },
      context,
    );

    expect(result).toMatchObject({
      error: { code: "JAVASCRIPT_TOO_MANY_FILES" },
    });
    expect(mocks.runInSandbox).not.toHaveBeenCalled();
  });

  it("rejects read files that exceed the total character budget", async () => {
    mocks.readWorkspaceBlob.mockResolvedValue({
      ok: true,
      value: {
        entry: { path: "big.txt" },
        blob: new Blob([
          "x".repeat(AGENT_WORKSPACE_LIMITS.maxSandboxFileChars + 1),
        ]),
      },
    });

    const result = await createJavaScriptBinding().execute(
      { code: "return 1;", readFiles: ["big.txt"] },
      context,
    );

    expect(result).toMatchObject({
      error: { code: "JAVASCRIPT_FILES_TOO_LARGE" },
    });
    expect(mocks.runInSandbox).not.toHaveBeenCalled();
  });

  it("loads a complete file beyond the ordinary workspace preview cap", async () => {
    const content = "x".repeat(AGENT_WORKSPACE_LIMITS.maxReadChars + 1);
    mocks.readWorkspaceBlob.mockResolvedValue({
      ok: true,
      value: {
        entry: { path: "large.txt" },
        blob: new Blob([content]),
      },
    });
    mocks.runInSandbox.mockResolvedValue(sandboxResult("done"));

    await createJavaScriptBinding().execute(
      { code: "return files['large.txt'].length;", readFiles: ["large.txt"] },
      context,
    );

    expect(mocks.runInSandbox).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      { files: { "large.txt": content }, captureFiles: false },
    );
  });

  it("refuses to inject a binary workspace file", async () => {
    mocks.readWorkspaceBlob.mockResolvedValue({
      ok: true,
      value: {
        entry: { path: "scan.pdf" },
        blob: new Blob(["not text"]),
      },
    });

    const result = await createJavaScriptBinding().execute(
      { code: "return 1;", readFiles: ["scan.pdf"] },
      context,
    );

    expect(result).toMatchObject({
      error: { code: "WORKSPACE_READ_FAILED" },
    });
    expect(mocks.runInSandbox).not.toHaveBeenCalled();
  });

  it("commits captured files back to the workspace", async () => {
    mocks.runInSandbox.mockResolvedValue(
      sandboxResult("ok", { "out.json": "{}" }),
    );

    const result = await createJavaScriptBinding().execute(
      { code: "writeFile('out.json', '{}');", writeFiles: true },
      context,
    );

    expect(mocks.writeWorkspaceText).toHaveBeenCalledWith(
      "session-1",
      "out.json",
      "{}",
      "overwrite",
    );
    expect(result).toEqual({ output: "ok", writtenFiles: ["out.json"] });
  });

  it("leaves the workspace untouched when the run fails", async () => {
    mocks.runInSandbox.mockResolvedValue(
      sandboxResult("Error: broken", { "out.json": "{}" }),
    );

    await createJavaScriptBinding().execute(
      {
        code: "writeFile('out.json', '{}'); throw new Error('broken');",
        writeFiles: true,
      },
      context,
    );

    expect(mocks.writeWorkspaceText).not.toHaveBeenCalled();
  });

  it("reports files it could not commit", async () => {
    mocks.runInSandbox.mockResolvedValue(
      sandboxResult("ok", { "../escape.txt": "x" }),
    );
    mocks.writeWorkspaceText.mockResolvedValue({
      ok: false,
      error: { code: "WORKSPACE_INVALID_PATH", message: "bad path" },
    });

    const result = await createJavaScriptBinding().execute(
      { code: "writeFile('../escape.txt', 'x');", writeFiles: true },
      context,
    );

    expect(result).toMatchObject({
      output: "ok",
      writeErrors: ["../escape.txt: bad path"],
    });
  });
});
