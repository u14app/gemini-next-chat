import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en";
import ja from "../i18n/locales/ja";
import zh from "../i18n/locales/zh";

describe("skill and panel copy", () => {
  it("uses normalized sidebar section titles", () => {
    expect(zh.Sidebar.assistantHub).toBe("助理");
    expect(zh.Sidebar.skillMarket).toBe("技能");
    expect(zh.Sidebar.pluginMarket).toBe("插件");
    expect(en.Sidebar.assistantHub).toBe("Assistants");
    expect(en.Sidebar.skillMarket).toBe("Skills");
    expect(en.Sidebar.pluginMarket).toBe("Plugins");
  });

  it("localizes stable skill category keys", () => {
    expect(zh.Skill.categories.analysis).toBe("分析");
    expect(zh.Skill.categories.developer).toBe("开发");
    expect(en.Skill.categories.analysis).toBe("Analysis");
    expect(en.Skill.categories.developer).toBe("Developer");
  });

  it("localizes required runtime select validation", () => {
    expect(en.Skill.parameters.runtime.selectRequired).toBeTruthy();
    expect(zh.Skill.parameters.runtime.selectRequired).toBeTruthy();
    expect(ja.Skill.parameters.runtime.selectRequired).toBeTruthy();
  });
});
