import { AGENT_ARCHIVE_LIMITS, AGENT_WORKSPACE_LIMITS } from "@/config/limits";
import type {
  ArchivePresentation,
  WorkspaceFilePresentation,
} from "@/lib/chat/types";

/**
 * Pure path and content helpers for the per-session agent workspace.
 *
 * Every workspace file lives under `opfs://chat/workspace/<sessionId>/`. Nothing
 * in this module performs I/O, so the traversal rules below can be exercised
 * directly in unit tests.
 */

export const WORKSPACE_OPFS_PREFIX = "chat/workspace";
export const WORKSPACE_UPLOADS_DIRECTORY = "uploads";
/**
 * Archives are stored outside the workspace tree so they are invisible to
 * `listWorkspace` and never counted by the workspace quota.
 */
export const ARCHIVE_OPFS_PREFIX = "chat/archives";

export type WorkspaceErrorCode =
  | "WORKSPACE_UNAVAILABLE"
  | "WORKSPACE_INVALID_PATH"
  | "WORKSPACE_FILE_NOT_FOUND"
  | "WORKSPACE_FILE_EXISTS"
  | "WORKSPACE_FILE_TOO_LARGE"
  | "WORKSPACE_QUOTA_EXCEEDED"
  | "WORKSPACE_EDIT_NO_MATCH"
  | "WORKSPACE_EDIT_AMBIGUOUS"
  | "WORKSPACE_READ_FAILED"
  | "WORKSPACE_WRITE_FAILED";

export interface WorkspaceError {
  code: WorkspaceErrorCode;
  message: string;
}

export type WorkspaceResult<T> =
  { ok: true; value: T } | { ok: false; error: WorkspaceError };

export const workspaceFailure = <T = never>(
  code: WorkspaceErrorCode,
  message: string,
): WorkspaceResult<T> => ({ ok: false, error: { code, message } });

const SAFE_SESSION_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;
const SAFE_WORKSPACE_SEGMENT =
  /^[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}._-]*[\p{L}\p{N}\p{M}_-])?$/u;

/**
 * Session ids are uuidv7 values, but they arrive here from persisted state, so
 * they are validated as a single path segment rather than trusted.
 */
export function getSessionWorkspaceRoot(sessionId: string): string | null {
  if (typeof sessionId !== "string") return null;
  const id = sessionId.trim();
  if (
    !id ||
    id.length > AGENT_WORKSPACE_LIMITS.maxPathSegmentChars ||
    !SAFE_SESSION_SEGMENT.test(id)
  ) {
    return null;
  }
  return `${WORKSPACE_OPFS_PREFIX}/${id}`;
}

/** Archive root for a session. Validated exactly like the workspace root. */
export function getSessionArchiveRoot(sessionId: string): string | null {
  const root = getSessionWorkspaceRoot(sessionId);
  if (!root) return null;
  return `${ARCHIVE_OPFS_PREFIX}/${root.slice(WORKSPACE_OPFS_PREFIX.length + 1)}`;
}

/**
 * Turns a model-supplied archive name into a safe `<name>.zip` segment.
 * Returns null when nothing usable survives, so the caller falls back to a
 * default rather than writing an attacker-chosen path.
 */
export function toArchiveFileName(name: unknown): string | null {
  if (typeof name !== "string") return null;

  const base = (name.split(/[\\/]/).pop() ?? "").replace(/\.zip$/i, "");
  const sanitized = base
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, "-")
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "")
    .slice(0, AGENT_ARCHIVE_LIMITS.maxArchiveNameChars);

  if (!sanitized || !SAFE_WORKSPACE_SEGMENT.test(sanitized)) return null;
  return `${sanitized}.zip`;
}

/**
 * Normalizes a model-supplied relative path. Anything that could escape the
 * session root, or that OPFS cannot represent, is rejected outright — this
 * never resolves `..` segments, it refuses them.
 */
export function normalizeWorkspacePath(
  relativePath: unknown,
): WorkspaceResult<string> {
  if (typeof relativePath !== "string") {
    return workspaceFailure(
      "WORKSPACE_INVALID_PATH",
      "A file path is required.",
    );
  }

  const trimmed = relativePath.trim().replace(/^\.\//, "");
  if (!trimmed) {
    return workspaceFailure(
      "WORKSPACE_INVALID_PATH",
      "A file path is required.",
    );
  }
  if (trimmed.length > AGENT_WORKSPACE_LIMITS.maxPathChars) {
    return workspaceFailure(
      "WORKSPACE_INVALID_PATH",
      `File paths must be at most ${AGENT_WORKSPACE_LIMITS.maxPathChars} characters.`,
    );
  }
  if (trimmed.startsWith("/") || trimmed.includes("\\")) {
    return workspaceFailure(
      "WORKSPACE_INVALID_PATH",
      "File paths must be relative to the workspace root and use forward slashes.",
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return workspaceFailure(
      "WORKSPACE_INVALID_PATH",
      "File paths must not contain control characters.",
    );
  }

  const segments = trimmed.split("/");
  if (segments.length > AGENT_WORKSPACE_LIMITS.maxPathDepth) {
    return workspaceFailure(
      "WORKSPACE_INVALID_PATH",
      `File paths must be at most ${AGENT_WORKSPACE_LIMITS.maxPathDepth} levels deep.`,
    );
  }
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.length > AGENT_WORKSPACE_LIMITS.maxPathSegmentChars ||
      !SAFE_WORKSPACE_SEGMENT.test(segment)
    ) {
      return workspaceFailure(
        "WORKSPACE_INVALID_PATH",
        `Invalid path segment: "${segment}".`,
      );
    }
  }

  return { ok: true, value: segments.join("/") };
}

/**
 * Resolves a relative workspace path to a fully scoped `opfs://` URL.
 */
export function resolveWorkspaceUrl(
  sessionId: string,
  relativePath: unknown,
): WorkspaceResult<{ path: string; url: string }> {
  const root = getSessionWorkspaceRoot(sessionId);
  if (!root) {
    return workspaceFailure(
      "WORKSPACE_UNAVAILABLE",
      "No session workspace is available for this request.",
    );
  }

  const normalized = normalizeWorkspacePath(relativePath);
  if (!normalized.ok) return normalized;

  return {
    ok: true,
    value: {
      path: normalized.value,
      url: `opfs://${root}/${normalized.value}`,
    },
  };
}

/** Converts an absolute OPFS path back to a workspace-relative path. */
export function toWorkspaceRelativePath(
  sessionId: string,
  opfsPath: string,
): string | null {
  const root = getSessionWorkspaceRoot(sessionId);
  if (!root) return null;
  const prefix = `${root}/`;
  const normalized = opfsPath.replace(/^opfs:\/\//, "");
  return normalized.startsWith(prefix)
    ? normalized.slice(prefix.length) || null
    : null;
}

const MIME_TYPES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/x-ndjson",
  xml: "application/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/plain",
  py: "text/x-python",
  sql: "application/sql",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  zip: "application/zip",
};

export function getWorkspaceFileName(path: string): string {
  return path.split("/").pop() || path;
}

export function guessWorkspaceMimeType(path: string): string {
  const name = getWorkspaceFileName(path);
  const extension = name.includes(".")
    ? name.split(".").pop()?.toLowerCase()
    : undefined;
  return (extension && MIME_TYPES[extension]) || "text/plain";
}

/**
 * Turns a user-supplied attachment file name into a safe `uploads/<name>` path.
 * Returns null when nothing usable survives sanitisation, so a hostile name is
 * dropped rather than coerced into some other file's path.
 */
export function toWorkspaceUploadPath(fileName: string): string | null {
  if (typeof fileName !== "string") return null;

  const base = fileName.split(/[\\/]/).pop() ?? "";
  const sanitizedBase = base
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, "-")
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "");
  const extension = sanitizedBase.match(/\.[a-z0-9]{1,16}$/i)?.[0] ?? "";
  const maxNameChars = 80;
  const sanitized =
    sanitizedBase.length <= maxNameChars
      ? sanitizedBase
      : `${sanitizedBase
          .slice(0, maxNameChars - extension.length)
          .replace(/[.-]+$/, "")}${extension}`;

  if (!sanitized || !SAFE_WORKSPACE_SEGMENT.test(sanitized)) return null;
  return `${WORKSPACE_UPLOADS_DIRECTORY}/${sanitized}`;
}

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/x-ndjson",
  "application/xml",
  "application/sql",
  "image/svg+xml",
]);

export function isTextWorkspaceMimeType(mimeType: string): boolean {
  return (
    TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    TEXT_MIME_TYPES.has(mimeType)
  );
}

export function isTextWorkspaceFile(path: string): boolean {
  return isTextWorkspaceMimeType(guessWorkspaceMimeType(path));
}

export interface WorkspaceEditResult {
  content: string;
  replacements: number;
}

/**
 * Exact-substring replacement. Rejecting ambiguous single-edit matches keeps the
 * model from silently changing the wrong occurrence.
 */
export function applyWorkspaceEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): WorkspaceResult<WorkspaceEditResult> {
  if (!oldString) {
    return workspaceFailure(
      "WORKSPACE_EDIT_NO_MATCH",
      "oldString must not be empty.",
    );
  }
  if (oldString === newString) {
    return workspaceFailure(
      "WORKSPACE_EDIT_NO_MATCH",
      "oldString and newString are identical.",
    );
  }

  let occurrences = 0;
  let index = content.indexOf(oldString);
  while (index !== -1) {
    occurrences += 1;
    if (occurrences > 1 && !replaceAll) break;
    index = content.indexOf(oldString, index + oldString.length);
  }

  if (occurrences === 0) {
    return workspaceFailure(
      "WORKSPACE_EDIT_NO_MATCH",
      "oldString was not found in the file. Read the file again and match its exact text.",
    );
  }
  if (occurrences > 1 && !replaceAll) {
    return workspaceFailure(
      "WORKSPACE_EDIT_AMBIGUOUS",
      "oldString matches more than once. Include more surrounding context, or set replaceAll to true.",
    );
  }

  return {
    ok: true,
    value: {
      content: replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString),
      replacements: occurrences,
    },
  };
}

/** Extracts a line range, mirroring the offset/limit shape of a file reader. */
export function sliceWorkspaceLines(
  content: string,
  offset?: number,
  limit?: number,
): {
  content: string;
  totalLines: number;
  startLine: number;
  truncated: boolean;
} {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const start = Math.max(0, Math.floor(offset ?? 0));
  const end =
    limit === undefined ? totalLines : start + Math.max(0, Math.floor(limit));
  const selected = lines.slice(start, end);

  let text = selected.join("\n");
  let truncated = end < totalLines || start > 0;
  if (text.length > AGENT_WORKSPACE_LIMITS.maxReadChars) {
    text = text.slice(0, AGENT_WORKSPACE_LIMITS.maxReadChars);
    truncated = true;
  }

  return { content: text, totalLines, startLine: start, truncated };
}

export function getWorkspaceTextBytes(content: string): number {
  return new TextEncoder().encode(content).length;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function isArchiveStorageUrl(url: string): boolean {
  const prefix = `opfs://${ARCHIVE_OPFS_PREFIX}/`;
  if (!url.startsWith(prefix)) return false;

  const segments = url.slice(prefix.length).split("/");
  if (segments.length !== 2) return false;
  const [sessionId, storageFileName] = segments;
  return (
    getSessionArchiveRoot(sessionId) ===
      `${ARCHIVE_OPFS_PREFIX}/${sessionId}` &&
    toArchiveFileName(storageFileName) === storageFileName
  );
}

function legacyWorkspaceRevision(
  url: string,
  path: string,
  bytes: number,
): string {
  let hash = 0x811c9dc5;
  const source = `${url}\0${path}\0${bytes}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `legacy-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Validates a persisted workspace file reference. Returns undefined for
 * anything whose URL does not point inside a session workspace, so a tampered
 * or stale block cannot be used to read unrelated OPFS paths.
 */
export function normalizeWorkspaceFilePresentation(
  input: unknown,
): WorkspaceFilePresentation | undefined {
  if (!isRecord(input)) return undefined;

  const path = normalizeWorkspacePath(input.path);
  if (!path.ok) return undefined;

  const url = typeof input.url === "string" ? input.url : "";
  if (
    !url.startsWith(`opfs://${WORKSPACE_OPFS_PREFIX}/`) ||
    !url.endsWith(`/${path.value}`)
  ) {
    return undefined;
  }

  const bytes =
    typeof input.bytes === "number" && Number.isFinite(input.bytes)
      ? Math.max(0, Math.floor(input.bytes))
      : 0;
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim().slice(0, 180)
      : undefined;
  const revision =
    typeof input.revision === "string" && input.revision.trim()
      ? input.revision.trim().slice(0, 160)
      : legacyWorkspaceRevision(url, path.value, bytes);

  return {
    path: path.value,
    fileName: getWorkspaceFileName(path.value),
    mimeType: guessWorkspaceMimeType(path.value),
    bytes,
    url,
    revision,
    ...(title ? { title } : {}),
  };
}

/**
 * Validates a persisted archive block. Mirrors
 * `normalizeWorkspaceFilePresentation`, but pins the URL to a validated
 * per-session archive path so a tampered block cannot read unrelated OPFS
 * content. The immutable storage file name may differ from the friendly
 * download name shown in the card.
 */
export function normalizeArchivePresentation(
  input: unknown,
): ArchivePresentation | undefined {
  if (!isRecord(input)) return undefined;

  const fileName = toArchiveFileName(input.fileName);
  if (
    !fileName ||
    typeof input.fileName !== "string" ||
    fileName !== input.fileName.trim()
  ) {
    return undefined;
  }

  const url = typeof input.url === "string" ? input.url : "";
  if (!isArchiveStorageUrl(url)) return undefined;

  const toCount = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : 0;
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim().slice(0, 180)
      : undefined;

  return {
    fileName,
    bytes: toCount(input.bytes),
    entryCount: toCount(input.entryCount),
    url,
    ...(title ? { title } : {}),
  };
}
