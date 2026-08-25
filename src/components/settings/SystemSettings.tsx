import React from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  Laptop,
  Loader2,
  Moon,
  Sun,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/store/core/settingsStore";
import { useCoreSettingsStore } from "@/store/core/coreSettingsStore";
import { useSetLocale } from "@/i18n/useSetLocale";
import { SegmentedControl, SimpleSwitch } from "@/components/ui/controls";
import { AppSettings, SystemPersonality } from "@/types";
import { SYSTEM_SETTINGS_LIMITS } from "@/config/limits";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BrowserAppDataSource } from "@/lib/data/clearAppData";
import type { AppBackupProgress } from "@/lib/data/appBackup";
import {
  clearAppRestoreCredentialNotice,
  readAppRestoreCredentialNotice,
} from "@/lib/data/appRestoreJournal";
import { Button } from "@/components/ui/primitives";

type TranslationOption<T extends string> = {
  value: T;
  labelKey: string;
  descriptionKey?: string;
  icon?: LucideIcon;
};

type DataSourceOption = {
  id: BrowserAppDataSource;
  labelKey: string;
  descriptionKey: string;
  locationKey: string;
};

type DataSourceGroup = {
  labelKey: string;
  descriptionKey: string;
  sources: BrowserAppDataSource[];
};

const DEFAULT_SELECTED_DATA_SOURCES: BrowserAppDataSource[] = ["cache"];

const THEME_OPTIONS: Array<TranslationOption<AppSettings["theme"]>> = [
  { value: "light", labelKey: "themeLight", icon: Sun },
  { value: "dark", labelKey: "themeDark", icon: Moon },
  { value: "system", labelKey: "themeSystem", icon: Laptop },
];

const INTERFACE_LANGUAGE_OPTIONS: Array<
  TranslationOption<AppSettings["language"]>
> = [
  { value: "en", labelKey: "langEnglish" },
  { value: "zh", labelKey: "langChinese" },
  { value: "ja", labelKey: "langJapanese" },
  { value: "auto", labelKey: "langSystem" },
];

const FONT_SIZE_OPTIONS: Array<
  TranslationOption<AppSettings["system"]["fontSize"]>
> = [
  { value: "small", labelKey: "fontSmall" },
  { value: "medium", labelKey: "fontMedium" },
  { value: "large", labelKey: "fontLarge" },
];

const PERSONALITY_OPTIONS: Array<TranslationOption<SystemPersonality>> = [
  {
    value: "default",
    labelKey: "personalityDefault",
    descriptionKey: "personalityDefaultDesc",
  },
  {
    value: "professional",
    labelKey: "personalityProfessional",
    descriptionKey: "personalityProfessionalDesc",
  },
  {
    value: "friendly",
    labelKey: "personalityFriendly",
    descriptionKey: "personalityFriendlyDesc",
  },
  {
    value: "direct",
    labelKey: "personalityDirect",
    descriptionKey: "personalityDirectDesc",
  },
  {
    value: "imaginative",
    labelKey: "personalityImaginative",
    descriptionKey: "personalityImaginativeDesc",
  },
  {
    value: "efficient",
    labelKey: "personalityEfficient",
    descriptionKey: "personalityEfficientDesc",
  },
  {
    value: "snarky",
    labelKey: "personalitySnarky",
    descriptionKey: "personalitySnarkyDesc",
  },
];

const DATA_SOURCE_OPTIONS: DataSourceOption[] = [
  {
    id: "cache",
    labelKey: "dataSourceCache",
    descriptionKey: "dataSourceCacheDesc",
    locationKey: "dataSourceCacheLocation",
  },
  {
    id: "settings",
    labelKey: "dataSourceSettings",
    descriptionKey: "dataSourceSettingsDesc",
    locationKey: "dataSourceSettingsLocation",
  },
  {
    id: "chats",
    labelKey: "dataSourceChats",
    descriptionKey: "dataSourceChatsDesc",
    locationKey: "dataSourceChatsLocation",
  },
  {
    id: "chatFiles",
    labelKey: "dataSourceChatFiles",
    descriptionKey: "dataSourceChatFilesDesc",
    locationKey: "dataSourceChatFilesLocation",
  },
  {
    id: "workspaceFiles",
    labelKey: "dataSourceWorkspaceFiles",
    descriptionKey: "dataSourceWorkspaceFilesDesc",
    locationKey: "dataSourceWorkspaceFilesLocation",
  },
  {
    id: "knowledge",
    labelKey: "dataSourceKnowledge",
    descriptionKey: "dataSourceKnowledgeDesc",
    locationKey: "dataSourceKnowledgeLocation",
  },
  {
    id: "memory",
    labelKey: "dataSourceMemory",
    descriptionKey: "dataSourceMemoryDesc",
    locationKey: "dataSourceMemoryLocation",
  },
  {
    id: "media",
    labelKey: "dataSourceMedia",
    descriptionKey: "dataSourceMediaDesc",
    locationKey: "dataSourceMediaLocation",
  },
];

const DATA_SOURCE_BY_ID = Object.fromEntries(
  DATA_SOURCE_OPTIONS.map((source) => [source.id, source]),
) as Record<BrowserAppDataSource, DataSourceOption>;

const DATA_SOURCE_GROUPS: DataSourceGroup[] = [
  {
    labelKey: "dataGroupStorage",
    descriptionKey: "dataGroupStorageDesc",
    sources: ["cache", "settings"],
  },
  {
    labelKey: "dataGroupConversations",
    descriptionKey: "dataGroupConversationsDesc",
    sources: ["chats", "chatFiles", "media"],
  },
  {
    labelKey: "dataGroupKnowledge",
    descriptionKey: "dataGroupKnowledgeDesc",
    sources: ["workspaceFiles", "knowledge", "memory"],
  },
];

const resolveLanguageValue = (language: string): AppSettings["language"] =>
  INTERFACE_LANGUAGE_OPTIONS.some((option) => option.value === language)
    ? (language as AppSettings["language"])
    : "auto";

function SystemSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border/70 px-4 py-4 sm:px-5">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="divide-y divide-border/70">{children}</div>
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
  align = "center",
  controlClassName = "",
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  align?: "center" | "start";
  controlClassName?: string;
}) {
  return (
    <div
      className={`grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)] sm:gap-6 sm:px-5 ${
        align === "start" ? "sm:items-start" : "sm:items-center"
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{title}</div>
        {description ? (
          <div className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <div className={`min-w-0 ${controlClassName}`}>{children}</div>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  ariaLabel,
  name,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  ariaLabel: string;
  name: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <SettingRow title={title} description={description}>
      <div className="flex justify-start sm:justify-end">
        <SimpleSwitch
          ariaLabel={ariaLabel}
          name={name}
          checked={checked}
          onChange={onChange}
        />
      </div>
    </SettingRow>
  );
}

function RadioDropdown<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  contentClassName = "w-[min(22rem,calc(100vw-2rem))]",
  hideOptionDescriptionsOnMobile = false,
}: {
  ariaLabel: string;
  options: Array<{
    value: T;
    label: string;
    description?: string;
    icon?: LucideIcon;
  }>;
  value: T;
  onChange: (value: T) => void;
  contentClassName?: string;
  hideOptionDescriptionsOnMobile?: boolean;
}) {
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  const SelectedIcon = selected.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="bare"
          type="button"
          aria-label={ariaLabel}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm text-foreground shadow-sm transition-[border-color,background-color,box-shadow] hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex min-w-0 items-center gap-2">
            {SelectedIcon ? (
              <SelectedIcon
                size={16}
                className="shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : null}
            <span className="min-w-0">
              <span className="block truncate font-medium">
                {selected.label}
              </span>
              {selected.description ? (
                <span
                  className={`mt-0.5 truncate text-xs text-muted-foreground ${
                    hideOptionDescriptionsOnMobile ? "hidden sm:block" : "block"
                  }`}
                >
                  {selected.description}
                </span>
              ) : null}
            </span>
          </span>
          <ChevronDown
            size={15}
            className="shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={`${contentClassName} rounded-xl p-1.5`}
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => onChange(nextValue as T)}
        >
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                indicatorPosition="right"
                indicator={<Check size={16} aria-hidden="true" />}
                className="h-auto min-h-10 rounded-lg px-3 py-2 pr-9 text-left data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
              >
                <span className="flex min-w-0 items-start gap-2">
                  {Icon ? (
                    <Icon
                      size={16}
                      className="mt-0.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span
                        className={`mt-0.5 text-xs leading-5 text-muted-foreground ${
                          hideOptionDescriptionsOnMobile
                            ? "hidden sm:block"
                            : "block"
                        }`}
                      >
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SystemSettings = () => {
  const t = useTranslations("System");
  const {
    clearDataSources,
    exportAllData,
    inspectBackupFile,
    restoreAllData,
    system,
    updateSystemSettings,
  } = useSettingsStore();
  const [isExportingData, setIsExportingData] = React.useState(false);
  const [exportProgress, setExportProgress] =
    React.useState<AppBackupProgress | null>(null);
  const [exportDataError, setExportDataError] = React.useState<string | null>(
    null,
  );
  const [isInspectingBackup, setIsInspectingBackup] = React.useState(false);
  const [isRestoringData, setIsRestoringData] = React.useState(false);
  const [restoreProgress, setRestoreProgress] =
    React.useState<AppBackupProgress | null>(null);
  const [restoreDataError, setRestoreDataError] = React.useState<string | null>(
    null,
  );
  const [restoreFile, setRestoreFile] = React.useState<File | null>(null);
  const [restoreInspection, setRestoreInspection] = React.useState<Awaited<
    ReturnType<typeof inspectBackupFile>
  > | null>(null);
  const [restoreCredentialNotice, setRestoreCredentialNotice] = React.useState(
    () => readAppRestoreCredentialNotice(),
  );
  const [isClearingData, setIsClearingData] = React.useState(false);
  const [isClearConfirming, setIsClearConfirming] = React.useState(false);
  const [clearDataError, setClearDataError] = React.useState<string | null>(
    null,
  );
  const [selectedDataSources, setSelectedDataSources] = React.useState<
    BrowserAppDataSource[]
  >(DEFAULT_SELECTED_DATA_SOURCES);
  const [isDataCleanupOpen, setIsDataCleanupOpen] = React.useState(false);
  const clearConfirmTimerRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const restoreInputRef = React.useRef<HTMLInputElement | null>(null);
  const exportAbortRef = React.useRef<AbortController | null>(null);
  const restoreAbortRef = React.useRef<AbortController | null>(null);

  const { theme, setTheme, language } = useCoreSettingsStore();
  const setLocale = useSetLocale();
  const selectedLanguage = resolveLanguageValue(language);

  React.useEffect(() => {
    return () => {
      if (clearConfirmTimerRef.current) {
        clearTimeout(clearConfirmTimerRef.current);
        clearConfirmTimerRef.current = null;
      }
      exportAbortRef.current?.abort();
      restoreAbortRef.current?.abort();
    };
  }, []);

  const clearClearConfirmation = () => {
    if (clearConfirmTimerRef.current) {
      clearTimeout(clearConfirmTimerRef.current);
      clearConfirmTimerRef.current = null;
    }
    setIsClearConfirming(false);
  };

  const toggleDataSource = (source: BrowserAppDataSource) => {
    setSelectedDataSources((current) =>
      current.includes(source)
        ? current.filter((item) => item !== source)
        : [...current, source],
    );
    clearClearConfirmation();
    setClearDataError(null);
  };

  const handleClearSelectedData = async () => {
    if (
      isClearingData ||
      isExportingData ||
      isRestoringData ||
      selectedDataSources.length === 0
    ) {
      return;
    }

    if (!isClearConfirming) {
      setClearDataError(null);
      setIsClearConfirming(true);
      if (clearConfirmTimerRef.current) {
        clearTimeout(clearConfirmTimerRef.current);
      }
      clearConfirmTimerRef.current = setTimeout(() => {
        clearConfirmTimerRef.current = null;
        setIsClearConfirming(false);
      }, 5000);
      return;
    }

    clearClearConfirmation();
    setIsClearingData(true);
    setClearDataError(null);
    try {
      await clearDataSources(selectedDataSources);
    } catch (error) {
      setClearDataError(
        error instanceof Error ? error.message : t("clearError"),
      );
      setIsClearingData(false);
    }
  };

  const handleExportAllData = async () => {
    if (isExportingData) {
      exportAbortRef.current?.abort();
      return;
    }
    if (isClearingData || isRestoringData) return;

    const controller = new AbortController();
    exportAbortRef.current = controller;
    setIsExportingData(true);
    setExportProgress(null);
    setExportDataError(null);
    try {
      const backup = await exportAllData({
        signal: controller.signal,
        onProgress: setExportProgress,
      });
      const url = URL.createObjectURL(backup.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = backup.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setExportDataError(
          error instanceof Error ? error.message : t("exportError"),
        );
      }
    } finally {
      exportAbortRef.current = null;
      setIsExportingData(false);
      setExportProgress(null);
    }
  };

  const clearRestoreSelection = () => {
    setRestoreFile(null);
    setRestoreInspection(null);
    setRestoreProgress(null);
    setRestoreDataError(null);
    if (restoreInputRef.current) restoreInputRef.current.value = "";
  };

  const handleRestoreFileSelection = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file || isExportingData || isInspectingBackup || isRestoringData) {
      return;
    }

    setRestoreFile(file);
    setRestoreInspection(null);
    setRestoreDataError(null);
    setIsInspectingBackup(true);
    try {
      setRestoreInspection(await inspectBackupFile(file));
    } catch (error) {
      setRestoreDataError(
        error instanceof Error ? error.message : t("restoreError"),
      );
    } finally {
      setIsInspectingBackup(false);
    }
  };

  const handleRestoreAllData = async () => {
    if (
      !restoreFile ||
      !restoreInspection ||
      isExportingData ||
      isRestoringData ||
      isClearingData
    ) {
      return;
    }

    setIsRestoringData(true);
    setRestoreProgress(null);
    setRestoreDataError(null);
    const controller = new AbortController();
    restoreAbortRef.current = controller;
    try {
      await restoreAllData(restoreFile, {
        signal: controller.signal,
        onProgress: setRestoreProgress,
      });
      window.location.reload();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setRestoreDataError(
          error instanceof Error ? error.message : t("restoreError"),
        );
      }
      restoreAbortRef.current = null;
      setIsRestoringData(false);
      setRestoreProgress(null);
    }
  };

  const handleRestoreAction = () => {
    if (isRestoringData) {
      if (restoreProgress?.phase !== "applying") {
        restoreAbortRef.current?.abort();
      }
      return;
    }
    void handleRestoreAllData();
  };

  const themeOptions = THEME_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
    icon: option.icon,
  }));
  const languageOptions = INTERFACE_LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }));
  const fontSizeOptions = FONT_SIZE_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }));
  const personalityOptions = PERSONALITY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
    description: option.descriptionKey ? t(option.descriptionKey) : undefined,
  }));

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <SystemSection
        title={t("systemInterfaceTitle")}
        description={t("systemInterfaceDesc")}
      >
        <SettingRow
          title={t("appearance")}
          description={t("appearanceThemeDesc")}
          controlClassName="sm:w-80"
        >
          <SegmentedControl
            ariaLabel={t("appearanceThemeAria")}
            options={themeOptions}
            value={theme}
            onChange={(val) => setTheme(val as AppSettings["theme"])}
          />
        </SettingRow>

        <SettingRow
          title={t("language")}
          description={t("interfaceLanguageDesc")}
          controlClassName="sm:w-72"
        >
          <RadioDropdown
            ariaLabel={t("interfaceLanguageAria")}
            options={languageOptions}
            value={selectedLanguage}
            onChange={(val) => setLocale(val)}
          />
        </SettingRow>

        <SettingRow
          title={t("fontSize")}
          description={t("fontSizeDesc")}
          controlClassName="sm:w-72"
        >
          <SegmentedControl
            ariaLabel={t("fontSizeAria")}
            options={fontSizeOptions}
            value={system.fontSize}
            onChange={(val) =>
              updateSystemSettings({
                fontSize: val as AppSettings["system"]["fontSize"],
              })
            }
          />
        </SettingRow>
      </SystemSection>

      <SystemSection
        title={t("systemAssistantTitle")}
        description={t("systemAssistantDesc")}
      >
        <SettingRow
          title={t("personalization")}
          description={t("personalizationDesc")}
          controlClassName="sm:w-64"
        >
          <RadioDropdown
            ariaLabel={t("personalityDropdown")}
            options={personalityOptions}
            value={system.personality}
            contentClassName="w-[min(18rem,calc(100vw-2rem))]"
            hideOptionDescriptionsOnMobile
            onChange={(value) =>
              updateSystemSettings({
                personality: value as SystemPersonality,
              })
            }
          />
        </SettingRow>

        <SettingRow
          title={t("systemPrompt")}
          description={t.rich("systemPromptDesc", {
            code: () => <code>{`<user-system-prompt>`}</code>,
          })}
          align="start"
          controlClassName="sm:w-[min(28rem,42vw)]"
        >
          <textarea
            name="systemPrompt"
            aria-label={t("systemPrompt")}
            value={system.systemPrompt}
            onChange={(event) =>
              updateSystemSettings({ systemPrompt: event.target.value })
            }
            maxLength={SYSTEM_SETTINGS_LIMITS.maxSystemPromptChars}
            autoComplete="off"
            spellCheck={false}
            className="h-36 w-full resize-none rounded-lg border border-input bg-background p-3 font-mono text-sm text-foreground shadow-sm transition-[border-color,box-shadow] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            placeholder={t("systemPromptPlaceholder")}
          />
        </SettingRow>
      </SystemSection>

      <SystemSection
        title={t("systemAutomationTitle")}
        description={t("systemAutomationDesc")}
      >
        <ToggleRow
          title={t("autoScroll")}
          description={t("autoScrollDesc")}
          ariaLabel={t("autoScrollAria")}
          name="enableAutoScroll"
          checked={system.enableAutoScroll === true}
          onChange={() =>
            updateSystemSettings({
              enableAutoScroll: system.enableAutoScroll !== true,
            })
          }
        />

        <ToggleRow
          title={t("destructiveToolConfirmation")}
          description={t("destructiveToolConfirmationDesc")}
          ariaLabel={t("destructiveToolConfirmationAria")}
          name="enableDestructiveToolConfirmation"
          checked={system.enableDestructiveToolConfirmation}
          onChange={() =>
            updateSystemSettings({
              enableDestructiveToolConfirmation:
                !system.enableDestructiveToolConfirmation,
            })
          }
        />

        <ToggleRow
          title={t("autoTitle")}
          description={t("autoTitleDesc")}
          ariaLabel={t("autoTitleAria")}
          name="enableAutoTitle"
          checked={system.enableAutoTitle}
          onChange={() =>
            updateSystemSettings({
              enableAutoTitle: !system.enableAutoTitle,
            })
          }
        />

        <ToggleRow
          title={t("relatedQuestions")}
          description={t("relatedQuestionsDesc")}
          ariaLabel={t("relatedQuestionsAria")}
          name="enableRelatedQuestions"
          checked={system.enableRelatedQuestions}
          onChange={() =>
            updateSystemSettings({
              enableRelatedQuestions: !system.enableRelatedQuestions,
            })
          }
        />

        <ToggleRow
          title={t("autoCollapseCode")}
          description={t("autoCollapseCodeDesc")}
          ariaLabel={t("autoCollapseCodeAria")}
          name="enableCodeCollapse"
          checked={system.enableCodeCollapse}
          onChange={() =>
            updateSystemSettings({
              enableCodeCollapse: !system.enableCodeCollapse,
            })
          }
        />

        <ToggleRow
          title={t("htmlVisualPrompt")}
          description={t("htmlVisualPromptDesc")}
          ariaLabel={t("htmlVisualPromptAria")}
          name="enableHtmlVisualPrompt"
          checked={system.enableHtmlVisualPrompt}
          onChange={() =>
            updateSystemSettings({
              enableHtmlVisualPrompt: !system.enableHtmlVisualPrompt,
            })
          }
        />

        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                {t("autoImageCompression")}
              </div>
              <div className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {t("autoImageCompressionDesc")}
              </div>
            </div>
            <SimpleSwitch
              ariaLabel={t("autoImageCompressionAria")}
              name="enableAutoImageCompression"
              checked={system.enableAutoImageCompression}
              onChange={() =>
                updateSystemSettings({
                  enableAutoImageCompression:
                    !system.enableAutoImageCompression,
                })
              }
            />
          </div>

          {system.enableAutoImageCompression ? (
            <div
              data-testid="image-compression-controls"
              className="mt-4 grid min-w-0 gap-4 rounded-lg bg-muted/45 p-4 sm:grid-cols-2"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                  <label
                    htmlFor="image-compression-max-size"
                    className="font-medium"
                  >
                    {t("imageCompressionMaxSize")}
                  </label>
                  <span className="shrink-0 font-mono text-foreground">
                    {t("imageCompressionSizeValue", {
                      value: system.imageCompressionMaxSizeMB,
                    })}
                  </span>
                </div>
                <input
                  id="image-compression-max-size"
                  name="imageCompressionMaxSizeMB"
                  type="range"
                  min={SYSTEM_SETTINGS_LIMITS.minImageCompressionMaxSizeMB}
                  max={SYSTEM_SETTINGS_LIMITS.maxImageCompressionMaxSizeMB}
                  step={SYSTEM_SETTINGS_LIMITS.imageCompressionMaxSizeMBStep}
                  value={system.imageCompressionMaxSizeMB}
                  onChange={(event) =>
                    updateSystemSettings({
                      imageCompressionMaxSizeMB: parseFloat(event.target.value),
                    })
                  }
                  aria-label={t("imageCompressionMaxSizeAria")}
                  aria-valuetext={t("imageCompressionSizeValue", {
                    value: system.imageCompressionMaxSizeMB,
                  })}
                  aria-describedby="image-compression-max-size-bounds"
                  className="h-1.5 w-full min-w-0 cursor-pointer appearance-none rounded-lg bg-input accent-brand"
                />
                <div
                  id="image-compression-max-size-bounds"
                  className="flex justify-between gap-2 text-[10px] text-muted-foreground"
                >
                  <span>
                    {t("imageCompressionSizeValue", {
                      value:
                        SYSTEM_SETTINGS_LIMITS.minImageCompressionMaxSizeMB,
                    })}
                  </span>
                  <span>
                    {t("imageCompressionSizeValue", {
                      value:
                        SYSTEM_SETTINGS_LIMITS.maxImageCompressionMaxSizeMB,
                    })}
                  </span>
                </div>
              </div>

              <div className="min-w-0 space-y-2">
                <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                  <label
                    htmlFor="image-compression-max-dimension"
                    className="font-medium"
                  >
                    {t("imageCompressionMaxDimension")}
                  </label>
                  <span className="shrink-0 font-mono text-foreground">
                    {t("imageCompressionDimensionValue", {
                      value: system.imageCompressionMaxWidthOrHeight,
                    })}
                  </span>
                </div>
                <input
                  id="image-compression-max-dimension"
                  name="imageCompressionMaxWidthOrHeight"
                  type="range"
                  min={
                    SYSTEM_SETTINGS_LIMITS.minImageCompressionMaxWidthOrHeight
                  }
                  max={
                    SYSTEM_SETTINGS_LIMITS.maxImageCompressionMaxWidthOrHeight
                  }
                  step={
                    SYSTEM_SETTINGS_LIMITS.imageCompressionMaxWidthOrHeightStep
                  }
                  value={system.imageCompressionMaxWidthOrHeight}
                  onChange={(event) =>
                    updateSystemSettings({
                      imageCompressionMaxWidthOrHeight: parseInt(
                        event.target.value,
                        10,
                      ),
                    })
                  }
                  aria-label={t("imageCompressionMaxDimensionAria")}
                  aria-valuetext={t("imageCompressionDimensionValue", {
                    value: system.imageCompressionMaxWidthOrHeight,
                  })}
                  aria-describedby="image-compression-max-dimension-bounds image-compression-aspect-ratio-note"
                  className="h-1.5 w-full min-w-0 cursor-pointer appearance-none rounded-lg bg-input accent-brand"
                />
                <div
                  id="image-compression-max-dimension-bounds"
                  className="flex justify-between gap-2 text-[10px] text-muted-foreground"
                >
                  <span>
                    {t("imageCompressionDimensionValue", {
                      value:
                        SYSTEM_SETTINGS_LIMITS.minImageCompressionMaxWidthOrHeight,
                    })}
                  </span>
                  <span>
                    {t("imageCompressionDimensionValue", {
                      value:
                        SYSTEM_SETTINGS_LIMITS.maxImageCompressionMaxWidthOrHeight,
                    })}
                  </span>
                </div>
              </div>

              <p
                id="image-compression-aspect-ratio-note"
                className="text-[11px] leading-relaxed text-muted-foreground sm:col-span-2"
              >
                {t("imageCompressionAspectRatioNote")}
              </p>
            </div>
          ) : null}
        </div>

        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                {t("autoCompress")}
              </div>
              <div className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                {t("autoCompressDesc")}
              </div>
            </div>
            <SimpleSwitch
              ariaLabel={t("autoCompressAria")}
              name="enableAutoCompression"
              checked={system.enableAutoCompression}
              onChange={() =>
                updateSystemSettings({
                  enableAutoCompression: !system.enableAutoCompression,
                })
              }
            />
          </div>

          {system.enableAutoCompression ? (
            <div className="mt-4 grid gap-4 rounded-lg bg-muted/45 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                  <label
                    htmlFor="compression-threshold"
                    className="font-medium"
                  >
                    {t("compressionThreshold")}
                  </label>
                  <span className="font-mono text-foreground">
                    {system.compressionThreshold}
                  </span>
                </div>
                <input
                  id="compression-threshold"
                  name="compressionThreshold"
                  type="range"
                  min={SYSTEM_SETTINGS_LIMITS.minCompressionThreshold}
                  max={SYSTEM_SETTINGS_LIMITS.maxCompressionThreshold}
                  step="1"
                  value={system.compressionThreshold}
                  onChange={(event) =>
                    updateSystemSettings({
                      compressionThreshold: parseInt(event.target.value, 10),
                    })
                  }
                  aria-describedby="compression-threshold-bounds"
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-input accent-brand"
                />
                <div
                  id="compression-threshold-bounds"
                  className="flex justify-between text-[10px] text-muted-foreground"
                >
                  <span>{SYSTEM_SETTINGS_LIMITS.minCompressionThreshold}</span>
                  <span>{SYSTEM_SETTINGS_LIMITS.maxCompressionThreshold}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                  <label htmlFor="history-keep-count" className="font-medium">
                    {t("keepHistory")}
                  </label>
                  <span className="font-mono text-foreground">
                    {system.historyKeepCount}
                  </span>
                </div>
                <input
                  id="history-keep-count"
                  name="historyKeepCount"
                  type="range"
                  min={SYSTEM_SETTINGS_LIMITS.minHistoryKeepCount}
                  max={SYSTEM_SETTINGS_LIMITS.maxHistoryKeepCount}
                  step="1"
                  value={system.historyKeepCount}
                  onChange={(event) =>
                    updateSystemSettings({
                      historyKeepCount: parseInt(event.target.value, 10),
                    })
                  }
                  aria-describedby="history-keep-count-bounds"
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-input accent-brand"
                />
                <div
                  id="history-keep-count-bounds"
                  className="flex justify-between text-[10px] text-muted-foreground"
                >
                  <span>{SYSTEM_SETTINGS_LIMITS.minHistoryKeepCount}</span>
                  <span>{SYSTEM_SETTINGS_LIMITS.maxHistoryKeepCount}</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </SystemSection>

      <SystemSection
        title={t("systemDataTitle")}
        description={t("systemDataDesc")}
      >
        <SettingRow
          title={t("exportAllData")}
          description={t("exportAllDataDesc")}
        >
          <div className="flex justify-start sm:justify-end">
            <Button
              variant="bare"
              type="button"
              onClick={handleExportAllData}
              disabled={isClearingData || isRestoringData}
              aria-busy={isExportingData}
              aria-label={isExportingData ? t("cancelBackup") : t("exportAria")}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isExportingData ? (
                <Loader2
                  size={14}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Download size={14} aria-hidden="true" />
              )}
              {isExportingData ? t("cancelBackup") : t("exportData")}
            </Button>
          </div>
          {exportProgress ? (
            <div
              aria-live="polite"
              className="mt-2 text-xs text-muted-foreground"
            >
              {t("backupProgress", {
                completed: exportProgress.completed,
                total: exportProgress.total,
              })}
            </div>
          ) : null}
          {exportDataError ? (
            <div
              role="alert"
              aria-live="polite"
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
            >
              {exportDataError}
            </div>
          ) : null}
        </SettingRow>

        <SettingRow
          title={t("restoreAllData")}
          description={t("restoreAllDataDesc")}
          align="start"
          controlClassName="sm:w-[min(28rem,42vw)]"
        >
          <input
            ref={restoreInputRef}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            onChange={handleRestoreFileSelection}
            className="sr-only"
            aria-label={t("restoreAria")}
          />
          <div className="flex justify-start sm:justify-end">
            <Button
              variant="bare"
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              disabled={
                isExportingData ||
                isInspectingBackup ||
                isRestoringData ||
                isClearingData
              }
              aria-busy={isInspectingBackup}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isInspectingBackup ? (
                <Loader2
                  size={14}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Upload size={14} aria-hidden="true" />
              )}
              {isInspectingBackup ? t("inspectingBackup") : t("selectBackup")}
            </Button>
          </div>

          {restoreInspection ? (
            <div className="mt-3 rounded-lg border border-border bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
              <div className="font-medium text-foreground">
                {t("restoreSummary", {
                  date: new Date(restoreInspection.exportedAt).toLocaleString(),
                  count: restoreInspection.fileCount,
                })}
              </div>
              <p className="mt-1">{t("restoreCredentialsNotice")}</p>
              {restoreInspection.incomplete ? (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                  <AlertTriangle
                    size={14}
                    className="mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {restoreInspection.kind === "legacy-json-v2"
                      ? t("legacyBackupWarning")
                      : t("incompleteBackupWarning", {
                          count: restoreInspection.missingFileCount,
                        })}
                  </span>
                </div>
              ) : null}
              {restoreInspection.skippedLegacyResearchTaskCount > 0 ? (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                  <AlertTriangle
                    size={14}
                    className="mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {t("legacyResearchSkippedWarning", {
                      count: restoreInspection.skippedLegacyResearchTaskCount,
                    })}
                  </span>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  variant="bare"
                  type="button"
                  onClick={clearRestoreSelection}
                  disabled={isRestoringData}
                  className="min-h-9 rounded-lg border border-border bg-background px-3 py-2 font-medium text-foreground hover:bg-accent disabled:opacity-60"
                >
                  {t("cancelRestore")}
                </Button>
                <Button
                  variant="bare"
                  type="button"
                  onClick={handleRestoreAction}
                  disabled={
                    isClearingData ||
                    isExportingData ||
                    (isRestoringData && restoreProgress?.phase === "applying")
                  }
                  aria-busy={isRestoringData}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-red-600 bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {isRestoringData ? (
                    <Loader2
                      size={14}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {isRestoringData
                    ? restoreProgress?.phase === "applying"
                      ? t("restoringBackup")
                      : t("cancelRestoreOperation")
                    : t("confirmRestore")}
                </Button>
              </div>
              {restoreProgress ? (
                <div
                  aria-live="polite"
                  className="mt-2 text-right text-xs text-muted-foreground"
                >
                  {t("backupProgress", {
                    completed: restoreProgress.completed,
                    total: restoreProgress.total,
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {restoreDataError ? (
            <div
              role="alert"
              aria-live="polite"
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100"
            >
              {restoreDataError}
            </div>
          ) : null}
          {restoreCredentialNotice ? (
            <div
              role="status"
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-100"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle
                  size={15}
                  className="mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {t("restoreCredentialChecklistTitle")}
                  </div>
                  <p className="mt-1 leading-relaxed">
                    {t("restoreCredentialChecklistDesc")}
                  </p>
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    <li>• {t("restoreCredentialProviders")}</li>
                    <li>• {t("restoreCredentialSearch")}</li>
                    <li>• {t("restoreCredentialRag")}</li>
                    <li>• {t("restoreCredentialVoice")}</li>
                    <li>• {t("restoreCredentialPlugins")}</li>
                  </ul>
                  <div className="mt-2 text-[11px] opacity-80">
                    {t("restoreCredentialRestoredAt", {
                      date: new Date(
                        restoreCredentialNotice.restoredAt,
                      ).toLocaleString(),
                    })}
                  </div>
                  <Button
                    variant="bare"
                    type="button"
                    onClick={() => {
                      clearAppRestoreCredentialNotice();
                      setRestoreCredentialNotice(null);
                    }}
                    className="mt-3 min-h-8 rounded-md border border-amber-300 bg-background px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900/40"
                  >
                    {t("restoreCredentialDismiss")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </SettingRow>

        <div>
          <Button
            variant="bare"
            type="button"
            aria-expanded={isDataCleanupOpen}
            aria-controls="system-data-cleanup-panel"
            onClick={() => setIsDataCleanupOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                {t("dataCleanup")}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {t("dataCleanupDesc")}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
              {isDataCleanupOpen ? t("hideDataCleanup") : t("showDataCleanup")}
              <ChevronDown
                size={16}
                className={`transition-transform ${isDataCleanupOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </span>
          </Button>

          {isDataCleanupOpen ? (
            <div
              id="system-data-cleanup-panel"
              className="border-t border-border/70 bg-muted/25"
            >
              <div className="grid gap-3 p-4 sm:p-5">
                {DATA_SOURCE_GROUPS.map((group) => (
                  <div
                    key={group.labelKey}
                    className="overflow-hidden rounded-lg border border-border bg-card"
                  >
                    <div className="border-b border-border/70 bg-muted/45 px-4 py-3">
                      <div className="text-sm font-medium text-foreground">
                        {t(group.labelKey)}
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t(group.descriptionKey)}
                      </div>
                    </div>
                    <div className="divide-y divide-border/70">
                      {group.sources.map((sourceId) => {
                        const source = DATA_SOURCE_BY_ID[sourceId];
                        const isSelected = selectedDataSources.includes(
                          source.id,
                        );

                        return (
                          <label
                            key={source.id}
                            className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/45"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleDataSource(source.id)}
                              className="mt-1 h-4 w-4 rounded border-input bg-background text-brand focus:ring-brand"
                              aria-label={t(source.labelKey)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm font-medium text-foreground">
                                  {t(source.labelKey)}
                                </span>
                                <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                                  {t(source.locationKey)}
                                </span>
                              </span>
                              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                                {t(source.descriptionKey)}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 border-t border-border/70 bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="text-xs text-muted-foreground">
                  {t("selectedDataSources", {
                    count: selectedDataSources.length,
                  })}
                </div>
                <Button
                  variant="bare"
                  type="button"
                  onClick={handleClearSelectedData}
                  disabled={
                    isClearingData ||
                    isExportingData ||
                    isRestoringData ||
                    selectedDataSources.length === 0
                  }
                  aria-busy={isClearingData}
                  aria-label={
                    isClearConfirming ? t("clearConfirmAria") : t("clearAria")
                  }
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-red-200 bg-background px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-background disabled:hover:text-red-600 dark:border-red-800 dark:text-red-400 dark:hover:text-white dark:disabled:hover:bg-background dark:disabled:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                >
                  {isClearingData ? (
                    <Loader2
                      size={14}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {isClearingData
                    ? t("clearing")
                    : isClearConfirming
                      ? t("confirmClear")
                      : t("clearSelectedData")}
                </Button>
              </div>

              {isClearConfirming && !isClearingData ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
                >
                  {t("clearConfirmHint", {
                    count: selectedDataSources.length,
                  })}
                </div>
              ) : null}
              {clearDataError ? (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
                >
                  {clearDataError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </SystemSection>
    </div>
  );
};

export default SystemSettings;
