import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("global Research activity bar composition", () => {
  it("occupies layout above the main content and hides inside the workbench", () => {
    const shell = readFileSync(
      resolve(process.cwd(), "src/components/app/ChatAppShell.tsx"),
      "utf8",
    );

    expect(shell).toContain('viewMode !== "research"');
    expect(shell).toContain('className="shrink-0"');
    expect(shell).toContain(
      'className="relative flex min-h-0 flex-1 flex-col overflow-hidden"',
    );
    expect(shell).toContain("<ConnectedResearchGlobalBar />");
    expect(shell).not.toContain(
      "pointer-events-none absolute inset-x-0 top-14",
    );
    expect(shell.indexOf("<ConnectedResearchGlobalBar />")).toBeLessThan(
      shell.indexOf('className="relative flex min-h-0 flex-1'),
    );
  });

  it("opens or resumes the selected global task without consulting the visible chat", () => {
    const connected = readFileSync(
      resolve(
        process.cwd(),
        "src/components/research/ConnectedResearchViews.tsx",
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

    expect(bar).toContain("selectGlobalResearchAttentionTaskId");
    expect(bar).toContain("getResearchRunResumeDecision(task, runsById)");
    expect(bar).toContain('resumeDecision.action === "unavailable"');
    expect(bar).toContain("openResearchTask(visibleTaskId)");
    expect(bar).toContain("runtime.resumeTask(visibleTaskId)");
    expect(bar).not.toContain("currentSessionId");
  });
});
