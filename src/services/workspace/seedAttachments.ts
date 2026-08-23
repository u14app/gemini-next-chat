import {
  isTextWorkspaceFile,
  isTextWorkspaceMimeType,
  guessWorkspaceMimeType,
  toWorkspaceUploadPath,
} from "@/lib/agent/workspace";
import { decodeBase64Text } from "@/lib/utils/documentAttachments";
import type { Attachment } from "@/types";
import { resolveOPFSBlob } from "@/utils/opfs";
import { writeWorkspaceBlob, writeWorkspaceText } from "./sessionWorkspace";

/**
 * Binary attachment types the agent can usefully work with. Anything outside
 * this list is left out of the workspace rather than copied blindly.
 */
const BINARY_SEED_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * Copies attachments into `uploads/` in the session workspace so agent tools and
 * `run_javascript` can reach them as ordinary files. Text files are written as
 * text; approved binary types are copied byte for byte. Failures are per-file
 * and non-fatal: a message must still send if seeding fails.
 */
export async function seedWorkspaceAttachments(
  sessionId: string,
  attachments: Attachment[] = [],
): Promise<string[]> {
  const seeded: string[] = [];

  for (const attachment of attachments) {
    if (attachment.localFileMissing) continue;
    const path = toWorkspaceUploadPath(attachment.fileName);
    if (!path) continue;

    // Both the declared mime type and the extension normally agree. Parsed
    // documents are the exception: their message payload contains extracted
    // Markdown while `url` still points to the original binary.
    const inferredMimeType = guessWorkspaceMimeType(path);
    const isText =
      isTextWorkspaceMimeType(attachment.mimeType) && isTextWorkspaceFile(path);
    const isParsedBinary =
      attachment.mimeType === "text/markdown" &&
      typeof attachment.data === "string" &&
      typeof attachment.url === "string";
    const isBinary =
      BINARY_SEED_MIME_TYPES.has(inferredMimeType) &&
      (attachment.mimeType === inferredMimeType || isParsedBinary);

    if (!isText && !isBinary) continue;

    if (isBinary) {
      try {
        const blob = attachment.url
          ? await resolveOPFSBlob(attachment.url)
          : null;
        if (!blob) continue;
        const written = await writeWorkspaceBlob(sessionId, path, blob);
        if (written.ok) seeded.push(written.value.path);
      } catch {
        // Non-fatal: the attachment is simply not available in the workspace.
      }
      continue;
    }

    let content: string | null = null;
    try {
      if (attachment.data) {
        content = decodeBase64Text(attachment.data);
      } else if (attachment.url) {
        const blob = await resolveOPFSBlob(attachment.url);
        content = blob ? await blob.text() : null;
      }
    } catch {
      content = null;
    }

    if (content === null || content === "") continue;

    const written = await writeWorkspaceText(
      sessionId,
      path,
      content,
      "overwrite",
    );
    if (written.ok) seeded.push(written.value.path);
  }

  return seeded;
}
