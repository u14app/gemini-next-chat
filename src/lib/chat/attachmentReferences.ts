import type {
  Attachment,
  Message,
  MessageOutputBlock,
  ToolCall,
  Workspace,
} from "@/types";

export const getAttachmentUrls = (files: Attachment[] = []): string[] => {
  const urls = new Set<string>();

  for (const file of files) {
    if (file.url) {
      urls.add(file.url);
    }
    if (file.displayCache?.opfsUrl) {
      urls.add(file.displayCache.opfsUrl);
    }
  }

  return Array.from(urls);
};

const getToolCallAttachmentUrls = (toolCalls: ToolCall[] = []): string[] => {
  const urls = new Set<string>();

  for (const toolCall of toolCalls) {
    for (const url of getAttachmentUrls(toolCall.resultImages)) {
      urls.add(url);
    }
  }

  return Array.from(urls);
};

export const getOutputBlockAttachmentUrls = (
  outputBlocks: MessageOutputBlock[] = [],
): string[] => {
  const urls = new Set<string>();

  for (const block of outputBlocks) {
    const blockUrls =
      block.type === "image"
        ? getAttachmentUrls([block.image])
        : block.type === "tool_group"
          ? getToolCallAttachmentUrls(block.toolCalls)
          : block.type === "text" && block.presentation?.document.url
            ? [block.presentation.document.url]
            : [];
    for (const url of blockUrls) {
      urls.add(url);
    }
  }

  return Array.from(urls);
};

export const getReferencedWorkspaceFileUrls = (workspaces: Workspace[]) => {
  const urls = new Set<string>();

  for (const workspace of workspaces) {
    for (const url of getAttachmentUrls(workspace.files)) {
      urls.add(url);
    }
  }

  return urls;
};

export const getMessageAttachmentUrls = (messages: Message[] = []) => {
  const urls = new Set<string>();

  for (const message of messages) {
    for (const url of getAttachmentUrls(message.attachments)) {
      urls.add(url);
    }
    for (const url of getToolCallAttachmentUrls(message.toolCalls)) {
      urls.add(url);
    }
    for (const url of getOutputBlockAttachmentUrls(message.outputBlocks)) {
      urls.add(url);
    }
  }

  return urls;
};

export const getRemovedWorkspaceFileUrls = (
  previousFiles: Attachment[] = [],
  nextFiles: Attachment[] = [],
) => {
  const nextUrls = new Set(getAttachmentUrls(nextFiles));

  return getAttachmentUrls(previousFiles).filter((url) => !nextUrls.has(url));
};
