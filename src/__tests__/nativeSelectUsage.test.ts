import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function collectTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("shared select usage", () => {
  it("does not render native select elements from production components", () => {
    const projectRoot = resolve(process.cwd());
    const files = ["src/components", "src/features"].flatMap((directory) =>
      collectTsxFiles(resolve(projectRoot, directory)),
    );
    const nativeSelects = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return /<(?:select|option)(?:\s|>)/.test(source)
        ? [relative(projectRoot, file)]
        : [];
    });

    expect(nativeSelects).toEqual([]);
  });
});
