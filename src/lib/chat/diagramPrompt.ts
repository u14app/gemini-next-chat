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

export const CHART_PROMPT_EXAMPLE = `{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["Quarter", "Sign-ups"],
    "source": [
      {"Quarter": "Q1", "Sign-ups": 184},
      {"Quarter": "Q2", "Sign-ups": 236},
      {"Quarter": "Q3", "Sign-ups": 219},
      {"Quarter": "Q4", "Sign-ups": 287}
    ]
  },
  "spec": {
    "title": {"text": "Quarterly sign-ups"},
    "tooltip": {"trigger": "axis"},
    "grid": {"left": 48, "right": 24, "top": 56, "bottom": 32},
    "xAxis": {"type": "category", "name": "Quarter"},
    "yAxis": {"type": "value", "name": "Sign-ups"},
    "color": ["#18B7C9", "#6FD6A7", "#8E7CF5", "#F5B85B", "#E8799C"],
    "series": [
      {
        "type": "bar",
        "encode": {"x": "Quarter", "y": "Sign-ups"}
      }
    ]
  }
}`;

const MINDMAP_PROMPT_FENCED_EXAMPLE = `\`\`\`mindmap
${MINDMAP_PROMPT_EXAMPLE}
\`\`\``;

const CHART_PROMPT_FENCED_EXAMPLE = `\`\`\`chart
${CHART_PROMPT_EXAMPLE}
\`\`\``;

const DIAGRAM_PROMPT_INSTRUCTION = `<format scope="request">
<diagram-rendering>
You may use diagram or chart code blocks when they make an answer clearer.
Use Mermaid in \`\`\`mermaid fenced code blocks for flows, sequence diagrams, state machines, dependency maps, timelines, entity relationships, and architecture overviews.
Use mind maps in \`\`\`mindmap fenced code blocks for hierarchical knowledge, topic breakdowns, study notes, taxonomies, brainstorms, and planning trees.
Use \`chart\` fenced code blocks for numeric data comparisons, trends, distributions, and other quantitative summaries. The application also accepts \`markdown-chart\` as a compatibility alias, but \`chart\` is the standard fence name.
Keep diagram syntax literal. Never insert HTML tags, HTML entities, inline styles, or visual wrappers into Mermaid or mindmap source, and never put diagram fences inside HTML containers.
Chart fences have a separate strict JSON contract:
1. Emit exactly one JSON object with \`"version": 1\` and \`"renderer": "echarts"\`.
2. Put the dataset in \`"data": {"kind": "inline", "dimensions": [...], "source": [...] }\`; use only the inline dataset form and never emit a \`ref\` dataset or external URL.
3. Put the ECharts option directly in \`"spec"\`. Do not nest it under \`option\`, add another version field, or include JavaScript, comments, trailing commas, functions, or unsafe formatter code.
4. Use valid ECharts option fields, map series to the named dimensions with \`encode\` when needed, and keep the series count at 12 or fewer.
5. Use only facts and rows supplied by the user or available context. If the data is missing or insufficient, say so instead of inventing values.
6. Prefer a coordinated, distinguishable multi-color palette for multiple series. Include explicit JSON hex colors in \`spec.color\` when color matters, such as \`#18B7C9\`, \`#6FD6A7\`, \`#8E7CF5\`, \`#F5B85B\`, and \`#E8799C\`. Keep one series color consistent, reserve an accent for emphasis, and never write CSS variables such as \`var(--chart-1)\` in ECharts JSON. The renderer supplies a theme-aware fallback only when colors are absent.
7. Close the \`chart\` fence before the short plain-text explanation of the chart. Keep JSON and its fence outside HTML visual wrappers.
Chart blocks are presentation for final user-facing narrative only. Never put chart envelopes in tool arguments, function inputs, Research plans or execution payloads, or other structured output contracts.
Use this complete valid chart example as the shape to imitate:
${CHART_PROMPT_FENCED_EXAMPLE}
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
When using Mermaid, mindmap, or chart diagrams, optimize the source for a polished, theme-aware rendering.
For Mermaid, prefer short node labels, clear grouping, readable flow direction, and avoid dense paragraphs inside nodes.
For mindmap, prefer one clear root topic, balanced breadth, roughly 2-4 useful levels, concise labels, and optional remarks instead of dense paragraphs inside nodes.
For charts, prefer a clear title, concise dimension names, readable units, a restrained but colorful palette, and a short explanation grounded in the supplied data. Keep explicit JSON hex colors stable across the series and never use CSS variables in the chart specification.
Keep chart backgrounds transparent. Apply custom colors to data series, not text: let the renderer choose readable title, legend, axis, and label colors for the current theme.
The renderer supports light and dark themes, so do not encode theme-specific colors unless the user asks for them.
Use enhanced visual style only when it improves comprehension. Visual polish must use native diagram syntax; never use HTML tags, HTML entities, or CSS inside a diagram fence.
</diagram-visual-polish>
</format>`;

const DIAGRAM_REQUEST_INSTRUCTIONS = `<format_instructions data-diagram-rendering="true">
For this request, you may output Mermaid diagrams in \`\`\`mermaid blocks, mind maps in \`\`\`mindmap blocks, and quantitative charts in \`\`\`chart blocks when they clarify complex structure or data.
Use Mermaid for flows, sequence, state, dependency, timeline, relationship, and architecture diagrams.
For a chart in a final user-facing narrative answer, prefer the standard \`chart\` fence and emit exactly one strict JSON object with \`version: 1\`, \`renderer: "echarts"\`, inline \`data\`, and an ECharts option in \`spec\`. Keep the data factual, use no more than 12 series, and use explicit JSON hex colors for a coordinated multi-color palette when colors are needed. Never use chart envelopes in tool arguments or structured outputs. Never use CSS variables, JavaScript, comments, external data references, or HTML wrappers. The legacy \`markdown-chart\` fence remains accepted.
For a mind map, output one fully closed \`\`\`mindmap fence. Its first tree-content line is an unprefixed root; every basic child starts with \`- \`; each deeper level adds exactly two spaces and never a tab.
Never insert HTML tags, HTML entities, styles, or wrappers into any diagram source.
Never put a Mermaid \`mindmap\` declaration, graph/flowchart syntax, JSON, or Markdown headings inside a mindmap fence. Use basic tree syntax by default and multiple blank-line-separated roots only when explicitly requested.
</format_instructions>`;

const DIAGRAM_ENHANCED_REQUEST_INSTRUCTIONS = `<format_instructions data-diagram-visual-polish="true">
When producing diagrams or charts, use the enhanced visual style guidance: concise labels, readable grouping, theme-aware source, balanced mindmap depth, and a coordinated explicit-hex chart palette grounded in the supplied data.
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
