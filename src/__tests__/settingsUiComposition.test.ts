import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en";
import ja from "../i18n/locales/ja";
import zh from "../i18n/locales/zh";

describe("settings UI primitives", () => {
  it("uses shadcn-style semantic tokens for select and switch controls", () => {
    const controls = readFileSync(
      resolve(process.cwd(), "src/components/ui/controls.tsx"),
      "utf8",
    );

    expect(controls).toContain("bg-background");
    expect(controls).toContain("border-input");
    expect(controls).toContain("focus-visible:ring-ring");
    expect(controls).toContain("data-[state=checked]");
    expect(controls).toContain("handleListboxKeyDown");
    expect(controls).toContain('event.key === "ArrowDown"');
    expect(controls).toContain('event.key === "Home"');
    expect(controls).toContain('event.key === "End"');
    expect(controls).toContain('event.key === "Escape"');
    expect(controls).toContain('event.key === " "');
    expect(controls).toContain("onMouseEnter={() => setHighlightedValue");
    expect(controls).toContain('role="combobox"');
    expect(controls).toContain("aria-activedescendant");
    const anchoredPortalSection = controls.slice(
      controls.indexOf("<AnchoredPortal"),
      controls.indexOf("</AnchoredPortal>"),
    );
    expect(anchoredPortalSection).not.toContain("aria-activedescendant");
    expect(controls).not.toContain(
      'type="button"\n                      role="option"',
    );
  });

  // Controls shared beyond the settings pages live in `ui/`; anything that
  // only search settings can use stays feature-local.
  it("keeps shared controls out of the search-specific provider item", () => {
    const controls = readFileSync(
      resolve(process.cwd(), "src/components/ui/controls.tsx"),
      "utf8",
    );
    const providerItem = readFileSync(
      resolve(process.cwd(), "src/components/settings/SearchProviderItem.tsx"),
      "utf8",
    );

    for (const control of [
      "CustomSelect",
      "SegmentedControl",
      "SimpleSwitch",
      "SecretInput",
    ]) {
      expect(controls).toContain(`export const ${control}`);
      expect(providerItem).not.toContain(`export const ${control}`);
    }

    expect(providerItem).toContain("export const SearchProviderItem");
    expect(controls).not.toContain("SearchProviderItem");
    expect(providerItem).toContain(
      'import { SecretInput } from "@/components/ui/controls"',
    );
    expect(providerItem).toContain(
      "focus-visible:ring-2 focus-visible:ring-blue-500/60",
    );
    expect(providerItem).toContain(
      'aria-label={`${name}: ${isActive ? t("active") : t("enable")}`}',
    );
  });

  it("uses the shared search capability resolver in search settings", () => {
    const searchSettings = readFileSync(
      resolve(process.cwd(), "src/components/settings/SearchSettings.tsx"),
      "utf8",
    );

    expect(searchSettings).toContain("resolveEffectiveSearchCapability");
    expect(searchSettings).toContain(
      'compatibility.source === "public_service"',
    );
    expect(searchSettings).toContain("capabilityPublicService");
    expect(searchSettings).not.toContain("capabilityMissingFirecrawl");
    expect(en.Search.capabilityPublicService).toContain("without an API key");
    expect(en.Search.capabilityPublicService).toContain(
      "directly from this browser",
    );
    expect(zh.Search.capabilityPublicService).toContain("浏览器会直接请求");
    expect(ja.Search.capabilityPublicService).toContain("ブラウザーから");
    expect(en.Search.capabilityServer).toBeTruthy();
    expect(zh.Search.capabilityServer).toBeTruthy();
    expect(ja.Search.capabilityServer).toBeTruthy();

    const deploymentHealth = readFileSync(
      resolve(process.cwd(), "src/components/settings/DeploymentHealth.tsx"),
      "utf8",
    );
    expect(deploymentHealth).toContain('t("searchReadyPublic")');
    expect(en.DeploymentHealth.searchReadyPublic).toContain("browser");
    expect(zh.DeploymentHealth.searchReadyPublic).toContain("浏览器");
    expect(ja.DeploymentHealth.searchReadyPublic).toContain("ブラウザー");
  });

  it("exposes memory management as a settings tab", () => {
    const settingsPage = readFileSync(
      resolve(process.cwd(), "src/components/settings/SettingsPage.tsx"),
      "utf8",
    );

    expect(settingsPage).toContain('id: "memory"');
    expect(settingsPage).toContain("tabMemory");
  });

  it("places keyboard shortcuts between system settings and about", () => {
    const settingsPage = readFileSync(
      resolve(process.cwd(), "src/components/settings/SettingsPage.tsx"),
      "utf8",
    );

    const systemIndex = settingsPage.indexOf('id: "system"');
    const shortcutIndex = settingsPage.indexOf('id: "shortcuts"');
    const aboutIndex = settingsPage.indexOf('id: "about"');

    expect(settingsPage).toContain("ShortcutsSettings");
    expect(settingsPage).toContain("Keyboard");
    expect(systemIndex).toBeLessThan(shortcutIndex);
    expect(shortcutIndex).toBeLessThan(aboutIndex);
    expect(en.SettingsPage.tabShortcuts).toBeTruthy();
    expect(zh.SettingsPage.tabShortcuts).toBeTruthy();
    expect(ja.SettingsPage.tabShortcuts).toBeTruthy();
  });

  it("organizes system settings into scalable grouped sections", () => {
    const systemSettings = readFileSync(
      resolve(process.cwd(), "src/components/settings/SystemSettings.tsx"),
      "utf8",
    );

    expect(systemSettings).toContain("SystemSection");
    expect(systemSettings).toContain("SettingRow");
    expect(systemSettings).toContain("ToggleRow");
    expect(systemSettings).toContain("RadioDropdown");
    expect(systemSettings).toContain("INTERFACE_LANGUAGE_OPTIONS");
    expect(systemSettings).toContain("systemInterfaceTitle");
    expect(systemSettings).toContain("systemAssistantTitle");
    expect(systemSettings).toContain("systemAutomationTitle");
    expect(systemSettings).toContain("systemDataTitle");
    expect(systemSettings).toContain(
      'name="enableDestructiveToolConfirmation"',
    );
    expect(systemSettings).toContain(
      'ariaLabel={t("destructiveToolConfirmationAria")}',
    );
    expect(systemSettings).toContain('name="enableAutoScroll"');
    expect(systemSettings).toContain('ariaLabel={t("autoScrollAria")}');
    expect(systemSettings).toContain('name="enableAutoImageCompression"');
    expect(systemSettings).toContain('name="imageCompressionMaxSizeMB"');
    expect(systemSettings).toContain('name="imageCompressionMaxWidthOrHeight"');
    expect(systemSettings).toContain(
      'aria-valuetext={t("imageCompressionSizeValue"',
    );
    expect(systemSettings).toContain(
      'aria-valuetext={t("imageCompressionDimensionValue"',
    );
    expect(systemSettings).toContain("sm:grid-cols-2");
    expect(systemSettings).toContain("imageCompressionAspectRatioNote");
    expect(systemSettings).toContain(
      "checked={system.enableAutoScroll === true}",
    );
    expect(
      systemSettings.indexOf('title={t("systemAutomationTitle")}'),
    ).toBeLessThan(systemSettings.indexOf('name="enableAutoScroll"'));
    expect(systemSettings.indexOf('name="enableAutoScroll"')).toBeLessThan(
      systemSettings.indexOf('name="enableDestructiveToolConfirmation"'),
    );
    expect(en.System.autoScroll).toBe("Auto-scroll output");
    expect(zh.System.autoScroll).toBe("自动输出滚动");
    expect(ja.System.autoScroll).toBe("出力中に自動スクロール");
    expect(en.System.autoImageCompression).toBe("Auto-compress images");
    expect(zh.System.autoImageCompression).toBe("自动压缩图片");
    expect(ja.System.autoImageCompression).toBe("画像を自動圧縮");
    expect(en.System.imageCompressionAspectRatioNote).toContain(
      "width is more than 5 times height",
    );
    expect(zh.System.imageCompressionAspectRatioNote).toContain(
      "宽度超过高度 5 倍",
    );
    expect(ja.System.imageCompressionAspectRatioNote).toContain(
      "幅が高さの 5 倍を超える",
    );
    expect(en.System.systemInterfaceTitle).toBeTruthy();
    expect(zh.System.systemInterfaceTitle).toBeTruthy();
    expect(ja.System.systemInterfaceTitle).toBeTruthy();
    expect(en.System.destructiveToolConfirmationDesc).toContain(
      "Other tool calls run automatically",
    );
    expect(zh.System.destructiveToolConfirmationDesc).toContain(
      "其他工具调用将自动执行",
    );
    expect(ja.System.destructiveToolConfirmationDesc).toContain(
      "その他のツール呼び出しは自動実行",
    );
  });

  it("uses a dropdown for interface language instead of a fixed segmented control", () => {
    const systemSettings = readFileSync(
      resolve(process.cwd(), "src/components/settings/SystemSettings.tsx"),
      "utf8",
    );
    const languageAriaIndex = systemSettings.indexOf("interfaceLanguageAria");
    const languageControlIndex = systemSettings.lastIndexOf(
      "RadioDropdown",
      languageAriaIndex,
    );
    const languageSection = systemSettings.slice(
      languageControlIndex,
      systemSettings.indexOf('title={t("fontSize")}', languageControlIndex),
    );

    expect(systemSettings).toContain("INTERFACE_LANGUAGE_OPTIONS");
    expect(languageSection).toContain("RadioDropdown");
    expect(languageSection).not.toContain("SegmentedControl");
  });

  it("keeps personality selection compact and trims option descriptions on mobile", () => {
    const systemSettings = readFileSync(
      resolve(process.cwd(), "src/components/settings/SystemSettings.tsx"),
      "utf8",
    );
    const personalizationIndex = systemSettings.indexOf(
      'title={t("personalization")}',
    );
    const personalitySection = systemSettings.slice(
      personalizationIndex,
      systemSettings.indexOf('title={t("systemPrompt")}', personalizationIndex),
    );

    expect(personalitySection).toContain('controlClassName="sm:w-64"');
    expect(personalitySection).toContain("hideOptionDescriptionsOnMobile");
    expect(systemSettings).toContain("hideOptionDescriptionsOnMobile = false");
    expect(systemSettings).toContain("hidden sm:block");
  });

  it("exposes image generation as a model capability in provider settings", () => {
    const providerSettings = readFileSync(
      resolve(process.cwd(), "src/components/settings/ProviderSettings.tsx"),
      "utf8",
    );
    const modelEditor = readFileSync(
      resolve(process.cwd(), "src/components/settings/ModelEditor.tsx"),
      "utf8",
    );

    expect(providerSettings).toContain("supportsImageGeneration");
    expect(providerSettings).toContain("capImageGeneration");
    expect(providerSettings).toContain("Image as ImageIcon");
    expect(modelEditor).toContain("image_generation");
    expect(modelEditor).toContain("modalities");
    expect(modelEditor).toContain("output:");
    expect(modelEditor).toContain("capImageGeneration");
    expect(en.Providers.capImageGeneration).toBe("Image Generation");
    expect(zh.Providers.capImageGeneration).toBe("图片生成");
    expect(ja.Providers.capImageGeneration).toBe("画像生成");
    expect(en.ModelEditor.capImageGeneration).toBe("Image Generation");
    expect(zh.ModelEditor.capImageGeneration).toBe("图片生成");
    expect(ja.ModelEditor.capImageGeneration).toBe("画像生成");
  });

  it("renders model metadata editing as a global page dialog", () => {
    const modelEditor = readFileSync(
      resolve(process.cwd(), "src/components/settings/ModelEditor.tsx"),
      "utf8",
    );

    expect(modelEditor).toContain("createPortal");
    expect(modelEditor).toContain("document.body");
    expect(modelEditor).toContain("useModalLifecycle");
    expect(modelEditor).toContain("trapModalFocus");
    expect(modelEditor).toContain("safe-area-inset-bottom");
    expect(modelEditor).toContain('role="dialog"');
    expect(modelEditor).toContain('aria-modal="true"');
    expect(modelEditor).toContain("tabIndex={-1}");
    expect(modelEditor).toContain("fixed inset-0");
    expect(modelEditor).not.toContain("absolute inset-0");
  });

  it("uses the settings select style for provider type selection", () => {
    const providerSettings = readFileSync(
      resolve(process.cwd(), "src/components/settings/ProviderSettings.tsx"),
      "utf8",
    );
    const providerTypeIndex = providerSettings.indexOf(
      "htmlFor={providerTypeInputId}",
    );
    const providerTypeSection = providerSettings.slice(
      providerTypeIndex,
      providerSettings.indexOf("providerBaseUrlInputId", providerTypeIndex),
    );

    expect(providerSettings).toContain("CustomSelect");
    expect(providerTypeSection).toContain("<CustomSelect");
    expect(providerTypeSection).toContain("providerTypeOptions");
    expect(providerSettings).toContain("/v1/chat/completions");
    expect(providerSettings).toContain("/v1/responses");
    expect(providerSettings).toContain("/v1/messages");
    expect(providerSettings).toContain("/v1beta/models");
    expect(providerSettings).toContain("ANTHROPIC_PROVIDER_TYPE");
    expect(providerSettings).toContain("GOOGLE_PROVIDER_TYPE");
    expect(providerTypeSection).toContain("renderProviderTypeOption");
    expect(providerTypeSection).toContain("selectButtonClassName");
    expect(providerTypeSection).toContain("bg-gray-50");
    expect(providerTypeSection).toContain("dark:bg-muted");
    expect(providerTypeSection).not.toContain("DropdownMenu");
    expect(providerTypeSection).not.toContain("shadow-sm");
    expect(providerTypeSection).not.toContain("<select");
    expect(providerTypeSection).not.toContain("description");
    expect(providerTypeSection).not.toContain("openaiCompatibleDesc");
    expect(providerTypeSection).not.toContain("openaiResponsesDesc");
    expect(providerTypeSection).not.toContain("geminiDesc");
    expect(providerTypeSection).not.toContain('value: "Gemini"');
  });

  it("keeps large provider model lists from forcing full eager layout", () => {
    const providerSettings = readFileSync(
      resolve(process.cwd(), "src/components/settings/ProviderSettings.tsx"),
      "utf8",
    );

    expect(providerSettings).toContain("[content-visibility:auto]");
    expect(providerSettings).toContain("[contain-intrinsic-size:");
  });
});
