import type { Attachment, Message, Session, Source } from "@/types";
import { getMessageOutputBlocks } from "@/lib/chat/messageOutputBlocks";
import { getSafeWebHref } from "@/lib/security/clientUrl";
import { getRemoteAttachmentUrlError } from "@/lib/security/remoteAttachment";
import { signedApiFetch } from "@/lib/api/client";
import { sha256 } from "@/lib/sharing/crypto";
import {
  assertShareSize,
  SharedConversationSchema,
} from "@/lib/sharing/schema";
import {
  SHARE_LIMITS,
  ShareError,
  getSharedImageMarker,
  type PreparedSessionShare,
  type ShareAsset,
  type SharedBlock,
} from "@/lib/sharing/types";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToArrayBuffer,
} from "@/lib/utils/binary";
import { prepareImageFileForAttachment } from "@/lib/utils/imageCompression";
import { resolveOPFSBlob } from "@/utils/opfs";
import { getResearchTaskRepository } from "@/services/research/runtime";
import { readResearchReportArtifact } from "@/services/research/reportArtifact";
import type { ResearchTask } from "@/lib/research/types";

interface MarkdownNode {
  type: string;
  url?: string;
  identifier?: string;
  alt?: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

interface SnapshotDependencies {
  readImage?: (
    source: string | Attachment,
    signal?: AbortSignal,
  ) => Promise<Blob>;
  prepareImage?: (
    blob: Blob,
    name: string,
    signal?: AbortSignal,
  ) => Promise<Blob>;
  loadResearchTask?: (id: string) => Promise<ResearchTask | null>;
  readReport?: (
    artifactId: string,
  ) => Promise<{ markdown: string; bytes: number } | null>;
}

function fileName(value: string) {
  return value.split(/[\\/]/).at(-1) || "Attachment";
}
function markdownAlt(value: string) {
  return value.replace(/[\[\]\\\r\n]/g, " ");
}

async function readImage(
  source: string | Attachment,
  signal?: AbortSignal,
): Promise<Blob> {
  const attachment = typeof source === "string" ? undefined : source;
  if (attachment?.data)
    return new Blob([bytesToArrayBuffer(base64ToBytes(attachment.data))], {
      type: attachment.mimeType,
    });
  const url = typeof source === "string" ? source : source.url;
  if (!url)
    throw new ShareError(
      "SHARE_IMAGE_MISSING",
      `The image ${attachment?.fileName || ""} is unavailable.`,
    );
  if (url.startsWith("opfs://")) {
    const blob = await resolveOPFSBlob(url);
    if (!blob)
      throw new ShareError(
        "SHARE_IMAGE_MISSING",
        `The image ${attachment?.fileName || ""} is missing from this browser.`,
      );
    return blob;
  }
  if (/^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(url)) {
    const split = url.indexOf(",");
    return new Blob([bytesToArrayBuffer(base64ToBytes(url.slice(split + 1)))], {
      type: url.slice(5, url.indexOf(";")),
    });
  }
  if (url.startsWith("blob:")) return (await fetch(url, { signal })).blob();
  if (getRemoteAttachmentUrlError(url))
    throw new ShareError(
      "SHARE_INVALID_IMAGE",
      "A shared image has an unsafe or unsupported URL.",
    );
  const response = await signedApiFetch("/api/media/image-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!response.ok)
    throw new ShareError(
      "SHARE_IMAGE_UNAVAILABLE",
      `An image could not be copied (${response.status}). The share was not updated.`,
    );
  return response.blob();
}

async function prepareImage(
  blob: Blob,
  name: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return prepareImageFileForAttachment(
    new File([blob], name, { type: blob.type }),
    {
      enabled: true,
      maxSizeMB: SHARE_LIMITS.imageBytes / (1024 * 1024),
      maxWidthOrHeight: 1920,
    },
    { signal, maxOutputBytes: SHARE_LIMITS.imageBytes },
  );
}

function publicSources(sources: Source[] = []) {
  return sources.flatMap((source) => {
    const url = getSafeWebHref(source.url);
    return url ? [{ title: source.title, url }] : [];
  });
}

/** Freezes the visible message path and resolves only its displayed media. */
export async function prepareSessionShare(
  {
    session,
    messages,
    signal,
  }: { session: Session; messages: readonly Message[]; signal?: AbortSignal },
  dependencies: SnapshotDependencies = {},
): Promise<PreparedSessionShare> {
  const frozenSession = structuredClone(session);
  if (frozenSession.retention === "temporary") {
    throw new ShareError(
      "SHARE_TEMPORARY_SESSION",
      "Temporary conversations cannot be shared.",
    );
  }
  const frozenMessages = structuredClone([...messages]);
  if (
    frozenMessages.some((message) => message.generation?.status === "streaming")
  )
    throw new ShareError(
      "SHARE_GENERATING",
      "Wait for the current response to finish before sharing.",
    );
  const assets = new Map<string, ShareAsset>();
  const imageReads = new Map<string, Promise<string>>();
  const registeredImages = new Map<string, Attachment>();
  for (const message of frozenMessages) {
    const images = [
      ...(message.attachments || []),
      ...getMessageOutputBlocks(message).flatMap((block) =>
        block.type === "image" ? [block.image] : [],
      ),
    ];
    for (const attachment of images)
      if (attachment.url && attachment.mimeType.startsWith("image/"))
        registeredImages.set(attachment.url, attachment);
  }
  let totalImageBytes = 0;
  const addImage = (source: string | Attachment): Promise<string> => {
    signal?.throwIfAborted();
    const url = typeof source === "string" ? source : source.url;
    if (typeof source === "string" && /^(opfs:|blob:)/.test(source)) {
      const registered = registeredImages.get(source);
      if (!registered)
        return Promise.reject(
          new ShareError(
            "SHARE_IMAGE_MISSING",
            "A local image is not attached to this conversation.",
          ),
        );
      source = registered;
    }
    const identity =
      typeof source === "string"
        ? source
        : source.data
          ? `${source.mimeType}:${source.data}`
          : source.url || source.id;
    const existing = imageReads.get(identity);
    if (existing) return existing;
    const pending = (async () => {
      const blob = await (dependencies.readImage || readImage)(source, signal);
      signal?.throwIfAborted();
      const prepared = await (dependencies.prepareImage || prepareImage)(
        blob,
        typeof source === "string" ? "image" : source.fileName,
        signal,
      );
      if (prepared.size > SHARE_LIMITS.imageBytes)
        throw new ShareError(
          "SHARE_IMAGE_TOO_LARGE",
          `The image ${typeof source === "string" ? "" : source.fileName} exceeds 512 KiB after compression.`,
          413,
        );
      if (
        ![
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
          "image/avif",
        ].includes(prepared.type)
      )
        throw new ShareError(
          "SHARE_INVALID_IMAGE",
          "This image format cannot be shared.",
        );
      const bytes = new Uint8Array(await prepared.arrayBuffer());
      const id = await sha256(bytes);
      if (!assets.has(id)) {
        totalImageBytes += bytes.byteLength;
        if (
          assets.size >= SHARE_LIMITS.imageCount ||
          totalImageBytes > SHARE_LIMITS.totalImageBytes
        )
          throw new ShareError(
            "SHARE_IMAGES_TOO_LARGE",
            "A share supports up to 32 images and 2 MiB of image data.",
            413,
          );
        assets.set(id, {
          id,
          mimeType: prepared.type as ShareAsset["mimeType"],
          data: bytesToBase64(bytes),
        });
      }
      return id;
    })();
    imageReads.set(identity, pending);
    if (url) imageReads.set(url, pending);
    return pending;
  };

  const [
    { unified },
    { default: remarkParse },
    { default: remarkGfm },
    { default: remarkMath },
  ] = await Promise.all([
    import("unified"),
    import("remark-parse"),
    import("remark-gfm"),
    import("remark-math"),
  ]);
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
  const rewriteImages = async (content: string) => {
    const tree = parser.parse(content) as unknown as MarkdownNode;
    const definitions = new Map<string, MarkdownNode>();
    const references = new Set<string>();
    const linkReferences = new Set<string>();
    const all: MarkdownNode[] = [];
    const walk = (node: MarkdownNode) => {
      if (
        node.type === "code" ||
        node.type === "inlineCode" ||
        node.type === "math" ||
        node.type === "inlineMath"
      )
        return;
      all.push(node);
      if (node.type === "definition" && node.identifier)
        definitions.set(node.identifier, node);
      if (node.type === "imageReference" && node.identifier)
        references.add(node.identifier);
      if (node.type === "linkReference" && node.identifier)
        linkReferences.add(node.identifier);
      node.children?.forEach(walk);
    };
    walk(tree);
    const edits: { start: number; end: number; value: string }[] = [];
    for (const node of all) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      if (node.type === "image" || node.type === "imageReference") {
        const url = node.url || definitions.get(node.identifier || "")?.url;
        if (!url) continue;
        const id = await addImage(url);
        edits.push({
          start,
          end,
          value: `![${markdownAlt(node.alt || "")}](<${getSharedImageMarker(id)}>)`,
        });
      } else if (
        node.type === "definition" &&
        references.has(node.identifier || "") &&
        !linkReferences.has(node.identifier || "")
      ) {
        // The image nodes are now self-contained; never leave signed image URLs in unused definitions.
        edits.push({ start, end, value: "" });
      } else if (node.type === "html" && node.value) {
        const value = node.value;
        const tags = [
          ...value.matchAll(/<img\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi),
        ];
        for (const tag of tags) {
          const src =
            /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag[0]);
          if (!src) continue;
          const decode = (text: string) => {
            if (typeof document === "undefined")
              return text.replace(/&amp;/g, "&");
            const textarea = document.createElement("textarea");
            textarea.innerHTML = text;
            return textarea.value;
          };
          const id = await addImage(decode(src[1] ?? src[2] ?? src[3]));
          const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag[0]);
          const safeAlt = (alt?.[1] ?? alt?.[2] ?? "").replace(/"/g, "&quot;");
          edits.push({
            start: start + tag.index!,
            end: start + tag.index! + tag[0].length,
            value: `<img src="${getSharedImageMarker(id)}" alt="${safeAlt}" />`,
          });
        }
      }
    }
    let rewritten = content;
    for (const edit of edits.sort((a, b) => b.start - a.start))
      rewritten =
        rewritten.slice(0, edit.start) + edit.value + rewritten.slice(edit.end);
    return rewritten;
  };

  const output: PreparedSessionShare = {
    snapshot: {
      schemaVersion: 1,
      title: frozenSession.title,
      createdAt: frozenMessages[0]?.timestamp ?? frozenSession.updatedAt,
      messages: [],
    },
    assets: [],
  };
  for (const message of frozenMessages) {
    signal?.throwIfAborted();
    const blocks: SharedBlock[] = [];
    for (const attachment of message.attachments || []) {
      if (attachment.mimeType.startsWith("image/"))
        blocks.push({
          type: "image",
          assetId: await addImage(attachment),
          alt: fileName(attachment.fileName),
        });
      else
        blocks.push({
          type: "attachment",
          fileName: fileName(attachment.fileName),
        });
    }
    for (const block of getMessageOutputBlocks(message)) {
      if (block.type === "text")
        blocks.push({
          type: "text",
          content: await rewriteImages(block.content),
        });
      else if (block.type === "image")
        blocks.push({
          type: "image",
          assetId: await addImage(block.image),
          alt: fileName(block.image.fileName),
        });
      else if (block.type === "workspace_file")
        blocks.push({
          type: "attachment",
          fileName: fileName(block.file.fileName),
        });
      else if (block.type === "workspace_archive")
        blocks.push({
          type: "attachment",
          fileName: fileName(block.archive.fileName),
        });
      else if (block.type === "search") {
        const sources = publicSources(block.sources);
        if (sources.length) blocks.push({ type: "sources", sources });
        for (const image of block.images) {
          const sourceUrl = getSafeWebHref(image.sourceUrl);
          blocks.push({
            type: "image",
            assetId: await addImage(image.url),
            alt: image.description || "",
            ...(sourceUrl ? { sourceUrl } : {}),
          });
        }
      } else if (block.type === "research_task") {
        const task = await (
          dependencies.loadResearchTask ||
          ((id) => getResearchTaskRepository().get(id))
        )(block.taskId);
        if (!task || task.sessionId !== frozenSession.id)
          throw new ShareError(
            "SHARE_REPORT_MISSING",
            "A research report is unavailable in this browser.",
          );
        const report =
          task.reportVersions.find(
            (candidate) => candidate.version === task.activeReportVersion,
          ) || task.reportVersions.at(-1);
        if (!report) continue;
        const artifact = await (
          dependencies.readReport || readResearchReportArtifact
        )(report.artifactId);
        if (!artifact)
          throw new ShareError(
            "SHARE_REPORT_MISSING",
            "A research report is missing from this browser.",
          );
        if (artifact.bytes > SHARE_LIMITS.snapshotBytes)
          throw new ShareError(
            "SHARE_TOO_LARGE",
            "The research report is too large to share.",
            413,
          );
        blocks.push({
          type: "report",
          title: task.goal,
          content: await rewriteImages(artifact.markdown),
        });
        // Pin illustration metadata to this report version, never to a later run.
        for (const image of report.imageSources || []) {
          const sourceUrl = getSafeWebHref(image.sourceUrl);
          blocks.push({
            type: "image",
            assetId: await addImage(image.url),
            alt: image.description || "",
            ...(sourceUrl ? { sourceUrl } : {}),
          });
        }
      }
    }
    const sources = publicSources(message.searchSources);
    if (sources.length && !blocks.some((block) => block.type === "sources"))
      blocks.push({ type: "sources", sources });
    output.snapshot.messages.push({
      id: message.id,
      role: message.role,
      timestamp: message.timestamp,
      blocks,
    });
  }
  output.assets = [...assets.values()];
  const parsed = SharedConversationSchema.safeParse(output.snapshot);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.code === "too_big"))
      throw new ShareError(
        "SHARE_TOO_LARGE",
        "Conversation text or metadata exceeds the sharing limits. Nothing was truncated or published.",
        413,
      );
    throw new ShareError(
      "SHARE_INVALID_SNAPSHOT",
      "The conversation could not be prepared for sharing.",
    );
  }
  output.snapshot = parsed.data;
  assertShareSize(output);
  return output;
}
