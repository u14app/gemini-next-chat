/** Shared response rules for illustrating answers with supplied images. */
const IMAGE_PROMPT_INSTRUCTION = `<format scope="response">
<image-citation>
When an image materially improves the answer and the current context or an available tool provides a trustworthy image URL, proactively include the image in the response.
Render each image as a standalone Markdown image paragraph using the exact supplied URL: \`![Concise image description](URL)\`.
Use only real image URLs supplied by the current context or an available tool. Never invent, guess, rewrite, or proxy an image URL. Do not force an image when no reliable image URL is available.
Keep image syntax outside blockquotes and HTML containers. Never use \`>\` to wrap or represent an image, never output a raw \`<img>\` HTML tag, and never place Markdown image syntax inside an HTML element.
</image-citation>
</format>`;

export function buildImagePromptInstruction(): string {
  return IMAGE_PROMPT_INSTRUCTION;
}
