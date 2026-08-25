import { API_INPUT_LIMITS } from "@/config/limits";
import { clampChatInputText } from "../utils/chatInput";

export const DIAGRAM_PROMPT_MARKER = "<diagram-rendering>";
export const DIAGRAM_ENHANCED_PROMPT_MARKER = "<diagram-visual-polish>";

export const MINDMAP_PROMPT_EXAMPLE = `Project Planning
  - Goals
    - Scope
    - Success criteria
  - Delivery
    - Milestones
    - Verification`;

const MINDMAP_PROMPT_FENCED_EXAMPLE = `\`\`\`mindmap
${MINDMAP_PROMPT_EXAMPLE}
\`\`\``;

const DIAGRAM_PROMPT_INSTRUCTION = `<format scope="request">
<diagram-rendering>
You may use diagram code blocks when they make an answer clearer.
Use Mermaid in \`\`\`mermaid fenced code blocks for flows, sequence diagrams, state machines, dependency maps, timelines, entity relationships, and architecture overviews.
Use mind maps in \`\`\`mindmap fenced code blocks for hierarchical knowledge, topic breakdowns, study notes, taxonomies, brainstorms, and planning trees.
Mindmap syntax is strict and syntax correctness takes priority over visual polish:
1. Put every mind map in a fully closed \`\`\`mindmap fenced code block. Never emit a bare or unclosed mind map.
2. The first tree-content line is the root node, with no list marker, number, or Markdown heading prefix.
3. In basic tree syntax, every child line starts with \`- \`. Indent each deeper level by exactly two additional spaces; never use tabs.
4. Close the fence immediately after the final node.
Use this complete valid example as the shape to imitate:
${MINDMAP_PROMPT_FENCED_EXAMPLE}
Inside a mindmap fence, never write a Mermaid \`mindmap\` declaration, \`graph\` or \`flowchart\`, JSON, or Markdown headings.
Use only the basic tree syntax by default. Frontmatter, task states, collapsed branches, tags, remarks, and cross-links are optional extensions; use them only when they add clear semantic value. If frontmatter is deliberately used, close it before the root so the first tree-content line is still the root.
Use one root tree unless the user explicitly asks for multiple independent roots. Only then separate complete root trees with a blank line.
Do not use diagrams for simple answers where prose, a short list, or a table is clearer.
</diagram-rendering>
</format>`;

const DIAGRAM_ENHANCED_PROMPT_INSTRUCTION = `<format scope="request">
<diagram-visual-polish>
When using Mermaid or mindmap diagrams, optimize the source for a polished, theme-aware rendering.
For Mermaid, prefer short node labels, clear grouping, readable flow direction, and avoid dense paragraphs inside nodes.
For mindmap, prefer one clear root topic, balanced breadth, roughly 2-4 useful levels, concise labels, and optional remarks instead of dense paragraphs inside nodes.
The renderer supports light and dark themes, so do not encode theme-specific colors unless the user asks for them.
Use enhanced visual style only when it improves comprehension.
</diagram-visual-polish>
</format>`;

const DIAGRAM_REQUEST_INSTRUCTIONS = `<format_instructions data-diagram-rendering="true">
For this request, you may output Mermaid diagrams in \`\`\`mermaid blocks and mind maps in \`\`\`mindmap blocks when they clarify complex structure.
Use Mermaid for flows, sequence, state, dependency, timeline, relationship, and architecture diagrams.
For a mind map, output one fully closed \`\`\`mindmap fence. Its first tree-content line is an unprefixed root; every basic child starts with \`- \`; each deeper level adds exactly two spaces and never a tab.
Never put a Mermaid \`mindmap\` declaration, graph/flowchart syntax, JSON, or Markdown headings inside a mindmap fence. Use basic tree syntax by default and multiple blank-line-separated roots only when explicitly requested.
</format_instructions>`;

const DIAGRAM_ENHANCED_REQUEST_INSTRUCTIONS = `<format_instructions data-diagram-visual-polish="true">
When producing diagrams, use the enhanced visual style guidance: concise labels, readable grouping, theme-aware source, and balanced mindmap depth.
</format_instructions>`;

export function buildDiagramPromptInstruction({
  enhanced = false,
}: { enhanced?: boolean } = {}): string {
  return enhanced
    ? `${DIAGRAM_PROMPT_INSTRUCTION}\n\n${DIAGRAM_ENHANCED_PROMPT_INSTRUCTION}`
    : DIAGRAM_PROMPT_INSTRUCTION;
}

export function isDiagramPromptInstructionEnabled(
  systemInstruction?: string,
): boolean {
  return Boolean(systemInstruction?.includes(DIAGRAM_PROMPT_MARKER));
}

export function isEnhancedDiagramPromptInstructionEnabled(
  systemInstruction?: string,
): boolean {
  return Boolean(systemInstruction?.includes(DIAGRAM_ENHANCED_PROMPT_MARKER));
}

export function appendDiagramRequestInstructions(
  message: string,
  systemInstruction?: string,
  maxChars: number = API_INPUT_LIMITS.maxChatTextChars,
): string {
  if (!isDiagramPromptInstructionEnabled(systemInstruction)) {
    return message;
  }
  if (message.includes('data-diagram-rendering="true"')) {
    return message;
  }

  const instructions = isEnhancedDiagramPromptInstructionEnabled(
    systemInstruction,
  )
    ? `${DIAGRAM_REQUEST_INSTRUCTIONS}\n\n${DIAGRAM_ENHANCED_REQUEST_INSTRUCTIONS}`
    : DIAGRAM_REQUEST_INSTRUCTIONS;
  const separator = "\n\n";
  const maxMessageChars = Math.max(
    0,
    maxChars - separator.length - instructions.length,
  );
  const boundedMessage = clampChatInputText(message, maxMessageChars);
  return `${boundedMessage}${separator}${instructions}`;
}
