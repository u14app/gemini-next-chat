import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("sidebar accessibility and localized titles", () => {
  it("removes collapsed animated session lists from focus and accessibility navigation", () => {
    const sidebar = readFileSync(
      resolve(process.cwd(), "src/components/layout/Sidebar.tsx"),
      "utf8",
    );

    expect(sidebar).toContain(
      "const isExpanded = expandedSections[sectionKey] === true",
    );
    expect(sidebar).toContain("inert={isExpanded ? undefined : true}");
    expect(sidebar).toContain("aria-hidden={!isExpanded}");
    expect(sidebar).toContain(
      `element.closest('[inert], [aria-hidden="true"]')`,
    );
  });

  it("does not mark a chat current while Skills or Search is current", () => {
    const sidebar = readFileSync(
      resolve(process.cwd(), "src/components/layout/Sidebar.tsx"),
      "utf8",
    );
    const activeState = sidebar.slice(
      sidebar.indexOf("const isActive ="),
      sidebar.indexOf("return (", sidebar.indexOf("const isActive =")),
    );

    expect(activeState).toContain("!isSkillMarketOpen");
    expect(activeState).toContain("!isGlobalSearchOpen");
  });

  it("provides localized duplicate-title templates for every locale", () => {
    const readMessages = (locale: "en" | "zh" | "ja") =>
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), `src/i18n/locales/${locale}/ChatApp.json`),
          "utf8",
        ),
      ) as { duplicateTitle: string };

    expect(readMessages("en").duplicateTitle).toBe("{title} (Copy)");
    expect(readMessages("zh").duplicateTitle).toBe("{title}（副本）");
    expect(readMessages("ja").duplicateTitle).toBe("{title}（コピー）");
  });

  it("delegates chat actions to the menu shared with the titlebar", () => {
    const sidebar = readFileSync(
      resolve(process.cwd(), "src/components/layout/Sidebar.tsx"),
      "utf8",
    );

    expect(sidebar).toContain("<SessionActionsMenu");
    expect(sidebar).not.toContain("setRenameOriginalTitle");
  });
});
