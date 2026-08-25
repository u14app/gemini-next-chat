import { createEvidenceSource } from "@/lib/agent/evidence";
import {
  isKnowledgeAttachment,
  processAttachmentsForModel,
} from "@/lib/utils/attachments";
import { resolveOPFSUrl } from "@/utils/opfs";

import type { BuiltinToolBinding } from "./types";

const ATTACHMENT_PREVIEW_CHARS = 12_000;

function error(code: string, message: string) {
  return { ok: false as const, error: { code, message, recoverable: true } };
}

/** Reads one attachment from the approved Research scope without a workspace write. */
export function createResearchAttachmentInspectionBinding(): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "inspect_attachment",
        description:
          "Inspect one attachment from the approved Research source scope by its attachment ID. Returns metadata, a bounded text preview when available, and an auditable evidence source.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            attachment_id: {
              type: "string",
              minLength: 1,
              maxLength: 240,
            },
          },
          required: ["attachment_id"],
        },
      },
    },
    risk: "read",
    descriptor: {
      version: 2,
      effects: ["local_read"],
      idempotency: "idempotent",
      sensitivity: "user_data",
      origin: "builtin",
    },
    displayKey: "inspectAttachment",
    executionGroup: "workspace",
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const attachmentId =
        typeof input.attachment_id === "string"
          ? input.attachment_id.trim()
          : "";
      if (!attachmentId) {
        return error(
          "ATTACHMENT_ARGUMENTS_INVALID",
          "inspect_attachment requires an attachment_id.",
        );
      }
      const attachment = context.knowledgeScope?.attachments.find(
        (candidate) => candidate.id === attachmentId,
      );
      if (!attachment || isKnowledgeAttachment(attachment)) {
        return error(
          "ATTACHMENT_SCOPE_DENIED",
          "The requested attachment is outside the approved Research source scope.",
        );
      }
      if (attachment.localFileMissing) {
        return error(
          "ATTACHMENT_SOURCE_MISSING",
          "The approved attachment is no longer available locally.",
        );
      }

      const processed = await processAttachmentsForModel(
        [{ ...attachment }],
        false,
        resolveOPFSUrl,
      );
      context.signal?.throwIfAborted();
      const preview = processed.convertedContent
        .trim()
        .slice(0, ATTACHMENT_PREVIEW_CHARS);
      const processedAttachment = processed.finalAttachments[0];
      const hashInput =
        processedAttachment?.data ||
        attachment.data ||
        preview ||
        attachment.url ||
        `${attachment.mimeType}:${attachment.fileName}:${attachment.id}`;
      const source = await createEvidenceSource(
        {
          title: attachment.fileName,
          url: `attachment://${encodeURIComponent(attachment.id)}`,
          content: hashInput,
        },
        { kind: "attachment" },
      );

      return {
        attachmentId: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        ...(preview
          ? {
              preview,
              previewTruncated:
                processed.convertedContent.trim().length > preview.length,
            }
          : {}),
        source: {
          ...source,
          content:
            preview ||
            `Approved binary attachment ${attachment.fileName} (${attachment.mimeType}).`,
        },
      };
    },
  };
}
