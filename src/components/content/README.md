# Content Components

Content components render model output and tool output in reusable formats.

## Files

- `Artifact.tsx` renders editable generated artifacts and preview controls.
- `MarkdownRenderer.tsx` renders CommonMark synchronously. The `markdown/` document module parses the complete source (including cross-block references), reconciles stable block snapshots, and imports GFM, HTML sanitization, math, highlighting, diagrams, file cards, and rich media only when their syntax is present. Pending or failed enhancements retain literal text; failed loads have a local retry. Completed blocks can enhance while later content is still streaming. All code fences remain literal, including Markdown fences containing HTML examples.
- `contentPolicy="evidence-answer"` preserves the evidence Q&A surface: skip raw HTML and images, retain safe research-styled links, and render code literally with optional lazy highlighting. Math and GFM remain lazy; file, diagram, media, citation-preview, and code-control adapters are never loaded by this policy. Citation validation remains in the existing Research domain module.
- `readOnly` loads a separate code viewer that never imports persisted chat/provider/settings stores. It disables code execution, executable HTML previews, generated-file actions, and private knowledge navigation. Copy, fold, fullscreen, and image preview remain available.
- Shared images may use `imageUrlAliases` only with exact `registeredImageUrls`: an alias is resolved exclusively at a real image node, and only a same-origin `/api/shares/{id}/assets/{64hex}?revision={n}` URL can bypass the normal remote-image policy. Code and file contents are never substituted. Optional `imageSources` adds supplied captions and safe source links; it never invents attribution.
- HTML parsing and sanitization load atomically. Footnote IDs stay in the document namespace; the only allowed input is an enforced disabled checkbox for task lists. Mermaid initialization and rendering are serialized, and diagram styling is independent of the HTML article-formatting setting.
- Dedicated highlight, math, diagram, and HTML styles load with their extension modules. GFM and HTML reuse the table stylesheet. Global CSS retains semantic tokens, CommonMark typography, shared attachment/code shells, and export/print overrides.
- `ReasoningBlock.tsx` renders model reasoning summaries or reasoning traces when available.
- `SourceBlock.tsx` renders web-search sources, image results, citation context, and visible search failure states.
- `ToolCallBlock.tsx` renders tool-call arguments, execution status, and results.

## Guidelines

- Keep formatting helpers in `src/lib/utils`.
- Keep rendering resilient to missing or partially streamed data.
- Treat tool results as untrusted display data and preserve safe formatting.
- Treat inline HTML, generated SVG, tool output, and artifact preview data as untrusted display data.
- Prefer shared primitives for copy, tooltip, and preview interactions.
