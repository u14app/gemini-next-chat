import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("global search source icons", () => {
  it("uses the folder icon for workspace filters and results", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/search/GlobalSearchCenter.tsx"),
      "utf8",
    );

    expect(source).toMatch(/if \(source === "workspace"\) return <Folder/);
    expect(source).not.toMatch(
      /if \(source === "workspace"\) return <FileText/,
    );
  });
});
