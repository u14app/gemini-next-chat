import { unified } from "unified";
import rehypeKatex from "rehype-katex";
import type { Root } from "hast";
import "katex/dist/katex.min.css";
import "./math.css";

const processor = unified().use(rehypeKatex, {
  trust: false,
  throwOnError: true,
});
export function renderMath(value: string, inline: boolean): Root {
  return processor.runSync({
    type: "root",
    children: [
      {
        type: "element",
        tagName: "code",
        properties: {
          className: ["language-math", inline ? "math-inline" : "math-display"],
        },
        children: [{ type: "text", value }],
      },
    ],
  }) as Root;
}
