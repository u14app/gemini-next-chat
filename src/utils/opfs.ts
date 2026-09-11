import { v7 as uuidv7 } from "uuid";
import { logDevError, logDevWarn } from "../lib/utils/devLogger";

/**
 * Utility for interacting with the Origin Private File System (OPFS).
 * Supports the custom 'opfs://' protocol for internal file references.
 */

const OPFS_PROTOCOL = "opfs://";
const MAX_OPFS_PATH_LENGTH = 1024;
type OPFSTools = typeof import("opfs-tools");

function loadOPFSTools(): Promise<OPFSTools> {
  return typeof window === "undefined"
    ? Promise.reject(
        new Error("OPFS tools are only available in a browser environment"),
      )
    : import("opfs-tools");
}

function getSafeRelativeOPFSPath(filePath: string): string | null {
  if (
    !filePath ||
    filePath.length > MAX_OPFS_PATH_LENGTH ||
    filePath.includes("\0") ||
    filePath.includes("\\") ||
    filePath.startsWith("/")
  ) {
    return null;
  }

  const segments = filePath.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }

  return filePath;
}

export function getSafeOPFSPath(url: string): string | null {
  if (!url.startsWith(OPFS_PROTOCOL)) return null;

  return getSafeRelativeOPFSPath(url.slice(OPFS_PROTOCOL.length));
}

/**
 * Saves a File object to the OPFS and returns an internal opfs:// URL.
 * Uses uuidv7 + extension for filename.
 * Supports optional directory prefix.
 *
 * @param file - The standard browser File object to save.
 * @param prefix - Optional directory prefix (e.g., 'images', 'chat/123').
 * @returns The opfs:// URL of the saved file.
 */
export async function saveToOPFS(
  file: File,
  prefix: string = "",
): Promise<string> {
  // Generate filename: uuidv7 + extension
  const nameParts = file.name.split(".");
  const rawExt = nameParts.length > 1 ? nameParts.pop() : "";
  const ext = rawExt && /^[a-z0-9]{1,16}$/i.test(rawExt) ? rawExt : "";
  const fileName = `${uuidv7()}${ext ? "." + ext : ""}`;

  // Construct full path with prefix
  // Remove leading/trailing slashes from prefix to avoid issues
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const filePath = cleanPrefix ? `${cleanPrefix}/${fileName}` : fileName;

  // Write file (opfs-tools handles directory creation automatically)
  // We use file.stream() (ReadableStream) or arrayBuffer() because File objects
  // are not Transferable (only Structured Cloneable), and opfs-tools might
  // try to transfer the content to its worker, causing errors if passed directly
  // in some contexts. ReadableStream is Transferable.
  const { write } = await loadOPFSTools();
  if (file.stream) {
    await write(filePath, file.stream());
  } else {
    // Fallback for older environments
    const buffer = await file.arrayBuffer();
    await write(filePath, buffer);
  }

  return `${OPFS_PROTOCOL}${filePath}`;
}

/**
 * Writes string content to an existing OPFS URL.
 */
export async function writeToOPFS(url: string, content: string): Promise<void> {
  const filePath = getSafeOPFSPath(url);
  if (!filePath) throw new Error("Invalid OPFS URL");
  const { write } = await loadOPFSTools();
  await write(filePath, content);
}

/**
 * Writes binary content to an exact app-owned OPFS URL. This is used by
 * validated backup restores, where persisted references must be rewritten to
 * deterministic staging paths before any application state is replaced.
 */
export async function writeBlobToOPFS(
  url: string,
  content: Blob | Uint8Array,
): Promise<void> {
  const filePath = getSafeOPFSPath(url);
  if (!filePath) throw new Error("Invalid OPFS URL");

  const { write } = await loadOPFSTools();
  if (content instanceof Blob && content.stream) {
    await write(filePath, content.stream());
    return;
  }

  const bytes =
    content instanceof Blob
      ? new Uint8Array(await content.arrayBuffer())
      : content;
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  await write(filePath, buffer);
}

/**
 * Deletes an OPFS URL if it exists.
 */
export async function deleteFromOPFS(url?: string): Promise<void> {
  if (!url) return;
  const filePath = getSafeOPFSPath(url);
  if (!filePath) return;
  const { file: read } = await loadOPFSTools();
  const target = read(filePath);
  if (await target.exists()) {
    await target.remove({ force: true });
  }
}

/**
 * Deletes an app-owned OPFS directory recursively.
 */
export async function deleteOPFSDirectory(path: string): Promise<void> {
  const safePath = getSafeRelativeOPFSPath(path);
  if (!safePath) return;

  const { dir } = await loadOPFSTools();
  const target = dir(safePath);
  if (await target.exists()) {
    await target.remove({ force: true });
  }
}

function normalizeOPFSPath(path: string): string {
  return path.replace(/^\/+/, "");
}

async function collectOPFSFilePaths(
  path: string,
  dir: OPFSTools["dir"],
): Promise<string[]> {
  const target = dir(path);
  if (!(await target.exists())) return [];

  const children = await target.children();
  const childPaths = await Promise.all(
    children.map((child) => {
      const childPath = normalizeOPFSPath(child.path);
      if (child.kind === "file") return Promise.resolve([childPath]);
      return collectOPFSFilePaths(childPath, dir);
    }),
  );

  return childPaths.flat();
}

/**
 * Lists app-owned file paths under an OPFS directory recursively.
 */
export async function listOPFSDirectory(path: string): Promise<string[]> {
  const safePath = getSafeRelativeOPFSPath(path);
  if (!safePath) return [];

  const { dir } = await loadOPFSTools();
  return collectOPFSFilePaths(safePath, dir);
}

/**
 * Reads the byte size of an app-owned OPFS URL without loading its content.
 * Returns null when the URL is invalid or the file does not exist.
 */
export async function statOPFSFileSize(url: string): Promise<number | null> {
  const filePath = getSafeOPFSPath(url);
  if (!filePath) return null;

  try {
    const { file: read } = await loadOPFSTools();
    const target = read(filePath);
    if (!(await target.exists())) return null;
    return await target.getSize();
  } catch (error) {
    logDevError(`Failed to stat OPFS file: ${filePath}`, error);
    return null;
  }
}

/**
 * Reads an opfs:// URL as UTF-8 text. Returns null when the file is missing.
 */
export async function readTextFromOPFS(url: string): Promise<string | null> {
  const filePath = getSafeOPFSPath(url);
  if (!filePath) return null;

  const { file: read } = await loadOPFSTools();
  const target = read(filePath);
  if (!(await target.exists())) return null;
  return await target.text();
}

/**
 * Resolves an opfs:// URL to a local ObjectURL (blob:).
 * Remember to revoke the URL when no longer needed to prevent memory leaks.
 */
export async function resolveOPFSUrl(url: string): Promise<string> {
  if (!url.startsWith(OPFS_PROTOCOL)) return url;

  const filePath = getSafeOPFSPath(url);
  if (!filePath) {
    logDevWarn("Invalid OPFS URL");
    return "";
  }

  try {
    const { file: read } = await loadOPFSTools();
    const file = read(filePath);
    if (!(await file.exists())) {
      logDevWarn(`OPFS File not found: ${filePath}`);
      return "";
    }

    // Create Blob and ObjectURL
    const fileBlob = await file.getOriginFile();
    if (!fileBlob) {
      logDevWarn(`Failed to get file blob: ${filePath}`);
      return "";
    }
    return URL.createObjectURL(fileBlob);
  } catch (error) {
    logDevError(`Failed to resolve OPFS file: ${filePath}`, error);
    return "";
  }
}

/**
 * Reads an opfs:// URL into a Blob without creating a blob: URL.
 */
export async function resolveOPFSBlob(url: string): Promise<Blob | null> {
  if (!url.startsWith(OPFS_PROTOCOL)) return null;

  const filePath = getSafeOPFSPath(url);
  if (!filePath) {
    logDevWarn("Invalid OPFS URL");
    return null;
  }

  try {
    const { file: read } = await loadOPFSTools();
    const file = read(filePath);
    if (!(await file.exists())) {
      logDevWarn(`OPFS File not found: ${filePath}`);
      return null;
    }

    const fileBlob = await file.getOriginFile();
    if (!fileBlob) {
      logDevWarn(`Failed to get file blob: ${filePath}`);
      return null;
    }
    return fileBlob;
  } catch (error) {
    logDevError(`Failed to read OPFS file: ${filePath}`, error);
    return null;
  }
}

/**
 * Checks if a URL is an OPFS protocol URL.
 */
export function isOPFSUrl(url?: string): boolean {
  return !!url && url.startsWith(OPFS_PROTOCOL);
}
