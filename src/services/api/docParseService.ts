import {
  getResponseErrorMessage,
  readJsonResponseOrThrow,
  signedApiFetch,
} from "@/lib/api/client";
import { encryptSecret, fetchWithByokRetry } from "@/lib/byok/client";
import { BYOK_CONTEXTS } from "@/lib/byok/shared";
import { logDevError } from "@/lib/utils/devLogger";
import type { DocumentParseProvider } from "@/types";

type DocumentParseStartResponse =
  | { markdown?: string }
  | { jobId?: string; jobSecret?: string; status?: "pending" };

type DocumentParseJobResponse =
  | { status: "pending" }
  | { status: "completed"; markdown?: string }
  | { status: "failed"; error?: string };

const DOC_PARSE_POLL_INTERVAL_MS = 2_000;
const DOC_PARSE_MAX_POLLS = 150;
const DOC_PARSE_TIMEOUT_ERROR =
  "Document parsing timed out. Please try again later.";

function createAbortError(): DOMException | Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Document parsing was cancelled", "AbortError");
  }
  const error = new Error("Document parsing was cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
    };
    const timer = globalThis.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      globalThis.clearTimeout(timer);
      cleanup();
      reject(createAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function shouldCancelPendingJob(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof Error && error.message === DOC_PARSE_TIMEOUT_ERROR)
  );
}

async function cancelDocumentParseJob(
  jobId: string,
  jobSecret: string,
): Promise<void> {
  await signedApiFetch(`/api/doc-parse/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    headers: {
      "x-doc-parse-job-secret": jobSecret,
    },
    cache: "no-store",
  });
}

async function pollDocumentParseJob(
  jobId: string,
  jobSecret: string,
  signal?: AbortSignal,
): Promise<string> {
  for (let attempt = 0; attempt < DOC_PARSE_MAX_POLLS; attempt += 1) {
    await sleep(DOC_PARSE_POLL_INTERVAL_MS, signal);

    const response = await signedApiFetch(
      `/api/doc-parse/jobs/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: {
          "x-doc-parse-job-secret": jobSecret,
        },
        cache: "no-store",
        signal,
      },
    );

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Document parsing failed"),
      );
    }

    const data = await readJsonResponseOrThrow<DocumentParseJobResponse>(
      response,
      "Document parsing failed",
    );

    if (data.status === "completed") return data.markdown || "";
    if (data.status === "failed") {
      throw new Error(data.error || "Document parsing failed");
    }
  }

  throw new Error(DOC_PARSE_TIMEOUT_ERROR);
}

function getDocumentParseSecretContext(
  provider: DocumentParseProvider,
): string {
  return provider === "mineru"
    ? BYOK_CONTEXTS.mineru
    : BYOK_CONTEXTS.llamaParse;
}

export async function parseDocumentFile(
  file: File,
  options: {
    provider: DocumentParseProvider;
    apiKey?: string;
    useDefault?: boolean;
    signal?: AbortSignal;
  },
): Promise<string> {
  const { provider, apiKey, useDefault = false, signal } = options;
  if (provider === "llamaParse" && !apiKey && !useDefault) {
    throw new Error("LlamaParse API Key is required");
  }

  let pendingJob: { id: string; secret: string } | null = null;
  try {
    throwIfAborted(signal);
    const response = await fetchWithByokRetry(async () => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("provider", provider);
      if (useDefault) {
        formData.append("useDefault", "true");
      } else if (apiKey) {
        formData.append(
          "apiKeySecret",
          JSON.stringify(
            await encryptSecret(
              apiKey,
              getDocumentParseSecretContext(provider),
            ),
          ),
        );
      }

      return signedApiFetch("/api/doc-parse", {
        method: "POST",
        body: formData,
        signal,
      });
    });

    if (!response.ok) {
      throw new Error(
        await getResponseErrorMessage(response, "Document parsing failed"),
      );
    }

    const data = await readJsonResponseOrThrow<DocumentParseStartResponse>(
      response,
      "Document parsing failed",
    );
    if ("markdown" in data) return data.markdown || "";
    if ("jobId" in data && data.jobId && data.jobSecret) {
      pendingJob = { id: data.jobId, secret: data.jobSecret };
      return await pollDocumentParseJob(data.jobId, data.jobSecret, signal);
    }

    throw new Error("Document parsing did not return a job id");
  } catch (error) {
    if (pendingJob && shouldCancelPendingJob(error)) {
      try {
        await cancelDocumentParseJob(pendingJob.id, pendingJob.secret);
      } catch (cancelError) {
        logDevError("Document parse job cancellation failed:", cancelError);
      }
    }
    if (!(error instanceof Error && error.name === "AbortError")) {
      logDevError("Document parse error:", error);
    }
    throw error;
  }
}

export async function parseDocumentWithLlama(
  file: File,
  apiKey?: string,
  useDefault = false,
): Promise<string> {
  return parseDocumentFile(file, {
    provider: "llamaParse",
    apiKey,
    useDefault,
  });
}
