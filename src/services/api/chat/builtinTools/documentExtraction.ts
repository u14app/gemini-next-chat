import { AGENT_WORKSPACE_LIMITS } from "@/config/limits";
import { parseDocumentFile } from "@/services/api/docParseService";
import { resolveDocumentParseToken } from "@/lib/security/localSecretResolvers";
import { useSettingsStore } from "@/store/core/settingsStore";
import {
  getWorkspaceFileEntry,
  readWorkspaceBlob,
  writeWorkspaceText,
} from "@/services/workspace/sessionWorkspace";

import type { BuiltinToolBinding } from "./types";

const PATH = {
  type: "string",
  minLength: 1,
  maxLength: AGENT_WORKSPACE_LIMITS.maxPathChars,
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function error(code: string, message: string) {
  return { ok: false as const, error: { code, message, recoverable: true } };
}

export function createDocumentExtractionBindings(): BuiltinToolBinding[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "inspect_attachment",
          description:
            "Inspect a seeded attachment in uploads/ without sending it externally. Returns MIME, size, hash, revision, and a bounded text preview when applicable.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: { path: PATH },
            required: ["path"],
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
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = record(args);
        const read = await readWorkspaceBlob(context.sessionId, input.path);
        if (!read.ok) return error(read.error.code, read.error.message);
        if (!read.value.entry.path.startsWith("uploads/")) {
          return error(
            "ATTACHMENT_SCOPE_DENIED",
            "inspect_attachment only accepts files in uploads/.",
          );
        }
        const isText =
          read.value.entry.mimeType.startsWith("text/") ||
          /\.(?:json|jsonl|csv|md|txt|xml|yaml|yml)$/i.test(
            read.value.entry.path,
          );
        const preview = isText
          ? (await read.value.blob.text()).slice(0, 4_000)
          : undefined;
        return {
          path: read.value.entry.path,
          fileName: read.value.entry.fileName,
          mimeType: read.value.entry.mimeType,
          bytes: read.value.entry.bytes,
          contentHash: read.value.entry.contentHash,
          revision: read.value.entry.revision,
          source: read.value.entry.source,
          ...(preview !== undefined
            ? {
                preview,
                previewTruncated: preview.length < read.value.entry.bytes,
              }
            : {}),
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "extract_document",
          description:
            "Extract PDF, DOCX, XLSX, PPTX, or another supported binary document to Markdown with the configured parser. The source is sent to that parser; output is revision-checked and saved in the workspace.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: PATH,
              sourceRevision: { type: "string", minLength: 1, maxLength: 256 },
              outputPath: PATH,
              outputExpectedRevision: {
                type: "string",
                minLength: 1,
                maxLength: 256,
              },
            },
            required: ["path", "sourceRevision", "outputPath"],
          },
        },
      },
      risk: "read",
      descriptor: {
        version: 2,
        effects: ["external_write", "local_write"],
        idempotency: "idempotent",
        sensitivity: "user_data",
        origin: "builtin",
      },
      displayKey: "extractDocument",
      agentOnly: true,
      executionGroup: "workspace",
      async execute(args, context) {
        context.signal?.throwIfAborted();
        const input = record(args);
        const read = await readWorkspaceBlob(context.sessionId, input.path);
        if (!read.ok) return error(read.error.code, read.error.message);
        if (read.value.entry.revision !== input.sourceRevision) {
          return error(
            "WORKSPACE_REVISION_CONFLICT",
            `Source changed; latest revision is ${read.value.entry.revision}.`,
          );
        }
        const rag = useSettingsStore.getState().rag;
        const provider = rag.documentParseProvider || "mineru";
        const useDefault = Boolean(
          rag.useDefaultDocumentProcessing &&
          rag.serverDocumentProcessingAvailable,
        );
        const apiKey = useDefault
          ? undefined
          : await resolveDocumentParseToken(provider, rag);
        if (provider === "llamaParse" && !useDefault && !apiKey) {
          return error(
            "DOCUMENT_PARSER_UNAVAILABLE",
            "Configure the selected document parser before extracting this file.",
          );
        }
        const file = new File([read.value.blob], read.value.entry.fileName, {
          type: read.value.entry.mimeType,
        });
        let markdown: string;
        try {
          markdown = await parseDocumentFile(file, {
            provider,
            apiKey,
            useDefault,
          });
        } catch (parseError) {
          if (context.signal?.aborted) throw parseError;
          return error(
            "DOCUMENT_EXTRACTION_FAILED",
            parseError instanceof Error
              ? parseError.message
              : "Document extraction failed.",
          );
        }
        const latest = await getWorkspaceFileEntry(
          context.sessionId,
          read.value.entry.path,
        );
        if (!latest.ok) return error(latest.error.code, latest.error.message);
        if (latest.value.revision !== read.value.entry.revision) {
          return error(
            "WORKSPACE_REVISION_CONFLICT",
            `Source changed during extraction; latest revision is ${latest.value.revision}.`,
          );
        }
        const outputPath = input.outputPath;
        const expectedOutputRevision =
          typeof input.outputExpectedRevision === "string"
            ? input.outputExpectedRevision
            : undefined;
        const written = await writeWorkspaceText(
          context.sessionId,
          outputPath,
          [
            `<!-- source: ${read.value.entry.path} -->`,
            `<!-- source-revision: ${read.value.entry.revision} -->`,
            `<!-- parser: ${provider} -->`,
            "",
            markdown,
          ].join("\n"),
          expectedOutputRevision ? "overwrite" : "create",
          { expectedRevision: expectedOutputRevision },
        );
        if (!written.ok)
          return error(written.error.code, written.error.message);
        return {
          sourcePath: read.value.entry.path,
          sourceRevision: read.value.entry.revision,
          parser: provider,
          output: written.value,
          provenancePreserved: /(?:page|页|sheet|slide|worksheet)/i.test(
            markdown,
          ),
        };
      },
    },
  ];
}
