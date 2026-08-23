import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_SANDBOX_LIMITS } from "../config/limits";
import { createSandboxHtml, runInSandbox } from "../utils/sandbox";

function installSandboxDomHarness() {
  let messageHandler: ((event: MessageEvent) => void) | undefined;
  let timeoutHandler: (() => void) | undefined;
  const contentWindow = { postMessage: vi.fn() };
  const iframe = {
    style: { display: "" },
    setAttribute: vi.fn(),
    remove: vi.fn(),
    contentWindow,
    srcdoc: "",
  };
  const appendChild = vi.fn();
  const addEventListener = vi.fn(
    (type: string, handler: (event: MessageEvent) => void) => {
      if (type === "message") messageHandler = handler;
    },
  );
  const removeEventListener = vi.fn();
  const clearTimeout = vi.fn();
  const setTimeout = vi.fn((handler: () => void) => {
    timeoutHandler = handler;
    return 17;
  });

  vi.stubGlobal("document", {
    createElement: vi.fn(() => iframe),
    body: { appendChild },
  });
  vi.stubGlobal("window", {
    location: { origin: "https://app.example" },
    addEventListener,
    removeEventListener,
    clearTimeout,
    setTimeout,
  });

  return {
    iframe,
    contentWindow,
    appendChild,
    addEventListener,
    removeEventListener,
    clearTimeout,
    getMessageHandler: () => messageHandler,
    getTimeoutHandler: () => timeoutHandler,
  };
}

function getRunId(srcdoc: string): string {
  const match = srcdoc.match(/const RUN_ID = ("[^"]+");/);
  if (!match?.[1]) throw new Error("Sandbox run id was not written to srcdoc.");
  return JSON.parse(match[1]) as string;
}

describe("browser sandbox hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("binds iframe messages to a run id and parent origin", () => {
    const html = createSandboxHtml("run-123", "https://app.example");

    expect(html).toContain('const RUN_ID = "run-123"');
    expect(html).toContain('const PARENT_ORIGIN = "https://app.example"');
    expect(html).toContain("data.runId !== RUN_ID");
    expect(html).toContain("typeof data.code !== 'string'");
    expect(html).toContain("parent.postMessage({ runId: RUN_ID");
    expect(html).toContain("}, PARENT_ORIGIN)");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("frame-src 'none'");
  });

  it("runs user JavaScript in a terminable worker inside the sandbox", () => {
    const html = createSandboxHtml("run-123", "https://app.example");

    expect(html).toContain("worker-src blob:");
    expect(html).toContain("new Worker(workerUrl)");
    expect(html).toContain("worker.terminate()");
    expect(html).toContain("JavaScript execution timed out.");
    expect(html).toContain(
      "Network access is disabled in the browser sandbox.",
    );
    expect(html).toContain("fetch");
    expect(html).toContain("SharedWorker");
    expect(html).toContain("XMLHttpRequest");
  });

  it("rejects oversized JavaScript before touching the DOM", async () => {
    const result = await runInSandbox(
      "x".repeat(BROWSER_SANDBOX_LIMITS.maxCodeChars + 1),
    );

    expect(result.output).toContain("too large");
  });

  it("rejects an already-aborted request before touching the DOM", async () => {
    const createElement = vi.fn();
    vi.stubGlobal("document", { createElement });
    const controller = new AbortController();
    controller.abort();

    await expect(
      runInSandbox("return 42;", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(createElement).not.toHaveBeenCalled();
  });

  it("cleans all parent resources when an active run is aborted", async () => {
    const harness = installSandboxDomHarness();
    const controller = new AbortController();
    const removeAbortListener = vi.spyOn(
      controller.signal,
      "removeEventListener",
    );
    const result = runInSandbox("return 42;", controller.signal);
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    const messageHandler = harness.getMessageHandler();
    const timeoutHandler = harness.getTimeoutHandler();

    expect(harness.appendChild).toHaveBeenCalledWith(harness.iframe);
    expect(messageHandler).toBeDefined();
    expect(timeoutHandler).toBeDefined();

    controller.abort();
    await rejection;

    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
    expect(harness.clearTimeout).toHaveBeenCalledWith(17);
    expect(harness.removeEventListener).toHaveBeenCalledWith(
      "message",
      messageHandler,
    );
    expect(removeAbortListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
    expect(harness.iframe.remove).toHaveBeenCalledTimes(1);

    timeoutHandler?.();
    messageHandler?.({} as MessageEvent);
    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
    expect(harness.iframe.remove).toHaveBeenCalledTimes(1);
  });

  it("preserves string results without a signal and settles only once", async () => {
    const harness = installSandboxDomHarness();
    const result = runInSandbox("return 42;");
    const messageHandler = harness.getMessageHandler();
    const timeoutHandler = harness.getTimeoutHandler();
    const runId = getRunId(harness.iframe.srcdoc);

    messageHandler?.({
      source: harness.contentWindow,
      data: { runId, ready: true },
    } as unknown as MessageEvent);
    expect(harness.contentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        code: "return 42;",
        files: {},
        maxWriteFiles: 0,
      }),
      "*",
    );

    messageHandler?.({
      source: harness.contentWindow,
      data: { runId, success: true, output: "42" },
    } as unknown as MessageEvent);

    await expect(result).resolves.toEqual({ output: "42", files: {} });
    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
    expect(harness.iframe.remove).toHaveBeenCalledTimes(1);

    timeoutHandler?.();
    messageHandler?.({
      source: harness.contentWindow,
      data: { runId, success: true, output: "late" },
    } as unknown as MessageEvent);
    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
    expect(harness.iframe.remove).toHaveBeenCalledTimes(1);
  });
});
