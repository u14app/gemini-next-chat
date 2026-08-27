import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("global Research activity bar composition", () => {
  it("lives in a non-layout overlay and hides inside the workbench", () => {
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );

    expect(shell).toContain('viewMode !== "research"');
    expect(shell).toContain("pointer-events-none absolute inset-x-0 top-14");
    expect(shell).toContain("<ConnectedResearchGlobalBar />");
  });

  it("opens the selected global task without consulting the visible chat", () => {
    const connected = readFileSync(
      resolve(
        process.cwd(),
        "src/features/research/ConnectedResearchViews.tsx",
      ),
      "utf8",
    );
    const barStart = connected.indexOf(
      "export function ConnectedResearchGlobalBar()",
    );
    const barEnd = connected.indexOf(
      "export function ConnectedResearchTaskList",
      barStart,
    );
    const bar = connected.slice(barStart, barEnd);

    expect(bar).toContain("selectGlobalActiveResearchTaskId");
    expect(bar).toContain("openResearchTask(visibleTaskId)");
    expect(bar).not.toContain("currentSessionId");
  });
});
