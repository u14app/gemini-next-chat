import {
  AGENT_WORKSPACE_LIMITS,
  BROWSER_SANDBOX_LIMITS,
} from "../config/limits";

type SandboxReadyMessage = { runId: string; ready: true };
type SandboxResultMessage = {
  runId: string;
  success: boolean;
  output?: string;
  error?: string;
  files?: Record<string, string>;
};
type SandboxMessage = SandboxReadyMessage | SandboxResultMessage;

function createSandboxRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getParentMessageOrigin(): string {
  const origin = window.location.origin;
  return origin && origin !== "null" ? origin : "*";
}

function createSandboxAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("JavaScript execution was aborted.", "AbortError");
  }
  const error = new Error("JavaScript execution was aborted.");
  error.name = "AbortError";
  return error;
}

function isSandboxMessage(
  value: unknown,
  runId: string,
): value is SandboxMessage {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    data.runId === runId &&
    (data.ready === true || typeof data.success === "boolean")
  );
}

function isSandboxReadyMessage(
  message: SandboxMessage,
): message is SandboxReadyMessage {
  return "ready" in message && message.ready === true;
}

function createSandboxWorkerScript(): string {
  return `
    const NETWORK_DISABLED_ERROR = 'Network access is disabled in the browser sandbox.';
    const stringifyValue = (value) => {
      if (typeof value !== 'object' || value === null) return String(value);
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };
    const blockNetwork = () => {
      throw new Error(NETWORK_DISABLED_ERROR);
    };
    const installBlockedGlobal = (name, value) => {
      try {
        Object.defineProperty(self, name, {
          configurable: false,
          writable: false,
          value,
        });
      } catch {
        try {
          self[name] = value;
        } catch {}
      }
    };

    installBlockedGlobal('fetch', blockNetwork);
    installBlockedGlobal('importScripts', blockNetwork);
    installBlockedGlobal('Worker', class Worker {
      constructor() {
        blockNetwork();
      }
    });
    installBlockedGlobal('SharedWorker', class SharedWorker {
      constructor() {
        blockNetwork();
      }
    });
    installBlockedGlobal('XMLHttpRequest', class XMLHttpRequest {
      constructor() {
        blockNetwork();
      }
    });
    installBlockedGlobal('WebSocket', class WebSocket {
      constructor() {
        blockNetwork();
      }
    });
    installBlockedGlobal('EventSource', class EventSource {
      constructor() {
        blockNetwork();
      }
    });

    self.addEventListener('message', (event) => {
      const data = event.data || {};
      if (typeof data.runId !== 'string' || typeof data.code !== 'string') return;

      const MAX_LOGS = 200;
      const MAX_OUTPUT_LENGTH = Number(data.maxOutputChars) || ${BROWSER_SANDBOX_LIMITS.maxOutputChars};
      let outputLength = 0;
      const logs = [];
      const pushLog = (value) => {
        const text = String(value);
        outputLength += text.length;
        if (logs.length < MAX_LOGS && outputLength <= MAX_OUTPUT_LENGTH) {
          logs.push(text);
        }
      };
      const formatArgs = (args) => args.map(stringifyValue).join(' ');

      const MAX_WRITE_FILES = Number(data.maxWriteFiles) || 0;
      const MAX_FILE_CHARS = Number(data.maxFileChars) || 0;
      const inputFiles = Object.freeze(Object.assign(Object.create(null), data.files || {}));
      const writtenFiles = Object.create(null);
      let writtenChars = 0;
      const writeFile = (path, content) => {
        if (MAX_WRITE_FILES <= 0) {
          throw new Error('File output is disabled for this run. Set writeFiles to true.');
        }
        if (typeof path !== 'string' || !path) {
          throw new Error('writeFile requires a file path.');
        }
        const text = typeof content === 'string' ? content : stringifyValue(content);
        if (!(path in writtenFiles) && Object.keys(writtenFiles).length >= MAX_WRITE_FILES) {
          throw new Error('writeFile exceeded the limit of ' + MAX_WRITE_FILES + ' output files.');
        }
        writtenChars += text.length - (writtenFiles[path] ? writtenFiles[path].length : 0);
        if (writtenChars > MAX_FILE_CHARS) {
          throw new Error('writeFile exceeded the total output size limit.');
        }
        writtenFiles[path] = text;
        return text.length;
      };
      const safeConsole = {
        log: (...args) => pushLog(formatArgs(args)),
        warn: (...args) => pushLog('WARN: ' + formatArgs(args)),
        error: (...args) => pushLog('ERROR: ' + formatArgs(args)),
        info: (...args) => pushLog('INFO: ' + formatArgs(args)),
      };

      try {
        const fn = new Function('console', 'files', 'writeFile', data.code);
        const result = fn(safeConsole, inputFiles, writeFile);

        if (result !== undefined) {
          pushLog(stringifyValue(result));
        }

        self.postMessage({
          runId: data.runId,
          success: true,
          output: logs.join('\\n'),
          files: writtenFiles,
        });
      } catch (err) {
        self.postMessage({
          runId: data.runId,
          success: false,
          error: String(err),
          output: logs.join('\\n'),
        });
      }
    });
  `;
}

export function createSandboxHtml(runId: string, parentOrigin: string): string {
  const serializedRunId = JSON.stringify(runId);
  const serializedParentOrigin = JSON.stringify(parentOrigin);
  const serializedWorkerScript = JSON.stringify(createSandboxWorkerScript());

  return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none'; img-src 'none'; media-src 'none'; worker-src blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'">
        <script>
          const RUN_ID = ${serializedRunId};
          const PARENT_ORIGIN = ${serializedParentOrigin};
          const WORKER_SCRIPT = ${serializedWorkerScript};
          const EXECUTION_TIMEOUT_MS = ${BROWSER_SANDBOX_LIMITS.executionTimeoutMs};
          const MAX_OUTPUT_CHARS = ${BROWSER_SANDBOX_LIMITS.maxOutputChars};
          let activeWorker = null;

          const stopActiveWorker = () => {
            if (activeWorker) {
              activeWorker.terminate();
              activeWorker = null;
            }
          };

          window.addEventListener('message', (e) => {
            const data = e.data || {};
            if (data.runId !== RUN_ID || typeof data.code !== 'string') return;

            stopActiveWorker();
            let workerUrl = '';
            try {
              const workerBlob = new Blob([WORKER_SCRIPT], { type: 'text/javascript' });
              workerUrl = URL.createObjectURL(workerBlob);
              const worker = new Worker(workerUrl);
              activeWorker = worker;
              let settled = false;
              let timeoutId = 0;

              const finish = (payload) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeoutId);
                worker.terminate();
                if (activeWorker === worker) {
                  activeWorker = null;
                }
                if (workerUrl) {
                  URL.revokeObjectURL(workerUrl);
                }
                parent.postMessage({ runId: RUN_ID, ...payload }, PARENT_ORIGIN);
              };

              worker.onmessage = (event) => {
                const result = event.data || {};
                if (result.runId !== RUN_ID) return;
                finish({
                  success: result.success === true,
                  output: typeof result.output === 'string' ? result.output : '',
                  error: typeof result.error === 'string' ? result.error : undefined,
                  files: result.files && typeof result.files === 'object' ? result.files : {},
                });
              };
              worker.onerror = (event) => {
                event.preventDefault();
                finish({
                  success: false,
                  error: event.message || 'Worker execution failed.',
                  output: '',
                });
              };
              timeoutId = window.setTimeout(() => {
                finish({
                  success: false,
                  error: 'JavaScript execution timed out.',
                  output: '',
                });
              }, EXECUTION_TIMEOUT_MS);
              worker.postMessage({
                runId: RUN_ID,
                code: data.code,
                maxOutputChars: MAX_OUTPUT_CHARS,
                files: data.files && typeof data.files === 'object' ? data.files : {},
                maxWriteFiles: Number(data.maxWriteFiles) || 0,
                maxFileChars: Number(data.maxFileChars) || 0,
              });
            } catch (err) {
              if (workerUrl) {
                URL.revokeObjectURL(workerUrl);
              }
              parent.postMessage({
                runId: RUN_ID,
                success: false,
                error: String(err),
                output: '',
              }, PARENT_ORIGIN);
            }
          });
          
          parent.postMessage({ runId: RUN_ID, ready: true }, PARENT_ORIGIN);
        </script>
      </head>
      <body></body>
      </html>
    `;
}

export interface SandboxRunOptions {
  /** Files exposed to the sandbox as the `files` global. */
  files?: Record<string, string>;
  /** Enables the `writeFile` global and captures what it buffers. */
  captureFiles?: boolean;
}

export interface SandboxRunResult {
  output: string;
  files: Record<string, string>;
}

/**
 * Runs code in an opaque-origin iframe worker. The sandbox never touches
 * storage: file contents are injected by the host and written output is
 * returned for the host to persist.
 */
export async function runInSandbox(
  code: string,
  signal?: AbortSignal,
  options: SandboxRunOptions = {},
): Promise<SandboxRunResult> {
  if (signal?.aborted) throw createSandboxAbortError();

  if (code.length > BROWSER_SANDBOX_LIMITS.maxCodeChars) {
    return {
      output:
        "Error: JavaScript code is too large to run in the browser sandbox.",
      files: {},
    };
  }

  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    const runId = createSandboxRunId();
    const parentOrigin = getParentMessageOrigin();
    let timeoutId = 0;
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", messageHandler);
      signal?.removeEventListener("abort", abortHandler);
      iframe.remove();
    };

    const settle = (complete: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      complete();
    };

    const abortHandler = () => {
      settle(() => reject(createSandboxAbortError()));
    };

    const messageHandler = (event: MessageEvent) => {
      if (settled) return;
      if (event.source !== iframe.contentWindow) return;
      if (!isSandboxMessage(event.data, runId)) return;

      if (isSandboxReadyMessage(event.data)) {
        // The sandbox has an opaque origin because it intentionally omits allow-same-origin.
        iframe.contentWindow?.postMessage(
          {
            runId,
            code,
            files: options.files || {},
            maxWriteFiles: options.captureFiles
              ? AGENT_WORKSPACE_LIMITS.maxSandboxWriteFiles
              : 0,
            maxFileChars: AGENT_WORKSPACE_LIMITS.maxSandboxFileChars,
          },
          "*",
        );
        return;
      }

      settle(() => {
        const files = event.data.files || {};
        if (event.data.success) {
          resolve({ output: event.data.output || "undefined", files });
          return;
        }

        const errorMsg = event.data.output
          ? `${event.data.output}\nError: ${event.data.error}`
          : `Error: ${event.data.error}`;
        resolve({ output: errorMsg, files: {} });
      });
    };

    try {
      iframe.style.display = "none";
      iframe.setAttribute("sandbox", "allow-scripts");
      window.addEventListener("message", messageHandler);
      signal?.addEventListener("abort", abortHandler, { once: true });
      if (signal?.aborted) {
        abortHandler();
        return;
      }

      document.body.appendChild(iframe);
      timeoutId = window.setTimeout(() => {
        settle(() =>
          resolve({
            output: "Error: JavaScript execution timed out.",
            files: {},
          }),
        );
      }, BROWSER_SANDBOX_LIMITS.executionTimeoutMs);
      iframe.srcdoc = createSandboxHtml(runId, parentOrigin);
    } catch (error) {
      settle(() => reject(error));
    }
  });
}
