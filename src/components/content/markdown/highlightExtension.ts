import { unified } from "unified";
import rehypeHighlight from "rehype-highlight";
import type { Root } from "hast";
import "./highlight.css";

const processor = unified().use(rehypeHighlight);
export function highlightCode(value: string, language: string): Root {
  return processor.runSync({
    type: "root",
    children: [
      {
        type: "element",
        tagName: "pre",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "code",
            properties: { className: language ? [`language-${language}`] : [] },
            children: [{ type: "text", value }],
          },
        ],
      },
    ],
  }) as Root;
}
