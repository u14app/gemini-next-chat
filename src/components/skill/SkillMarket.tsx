"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  ScrollText,
  Trash2,
  X,
  Layers3,
} from "lucide-react";
import type { SkillBundle, SkillCatalogEntry, TextSkill } from "@/types";
import { useSettingsStore } from "@/store/core/settingsStore";
import { normalizeTextSkill } from "@/lib/skills";
import {
  fetchSkillCatalogResult,
  fetchSkillDefinition,
} from "@/services/api/skillService";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MARKET_LIMITS } from "@/config/limits";
import { logDevError } from "@/lib/utils/devLogger";
import type { MarketLoadResult } from "@/lib/market/loadResult";
import MarketLoadNotice from "@/components/ui/MarketLoadNotice";
import SkillParameterEditor from "./SkillParameterEditor";
import SkillBundleEditor from "./SkillBundleEditor";
import { Button } from "@/components/ui/primitives";

interface SkillMarketProps {
  onClose: () => void;
}

const ITEMS_PER_PAGE = 24;
const focusableModalSelector =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const trapModalFocus = (
  event: React.KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
) => {
  if (event.key !== "Tab" || !container) return;

  const focusableElements = Array.from(
    container.querySelectorAll<HTMLElement>(focusableModalSelector),
  ).filter((element) => element.offsetParent !== null);

  if (focusableElements.length === 0) {
    event.preventDefault();
    container.focus({ preventScroll: true });
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus({ preventScroll: true });
  }
};

const titleCaseCategoryName = (value: string) =>
  value
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

type SkillCategoryTranslator = {
  (key: string): string;
  has(key: string): boolean;
};

export const formatCategoryName = (
  value: string,
  translate: SkillCategoryTranslator,
) => {
  const key = `categories.${value}`;
  return translate.has(key) ? translate(key) : titleCaseCategoryName(value);
};

const slugifySkillId = (value: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MARKET_LIMITS.maxSkillIdChars);
  return slug || `custom-skill-${Date.now()}`;
};

const createDefaultSkill = (locale: string): TextSkill => ({
  id: "",
  name: "",
  title: "",
  description: "",
  category: "custom",
  tags: [],
  audience: "user-facing",
  language: locale?.toLowerCase().startsWith("zh") ? "zh-CN" : "en",
  outputFormat: "markdown",
  risk: {
    level: "low",
    textOnly: true,
    scriptRequired: false,
    externalToolRequired: false,
    networkRequired: false,
    reviewRequiredForHighStakes: true,
  },
  activation: {
    embeddingText: "",
    useWhen: [],
    avoidWhen: [],
    exampleQueries: [],
  },
  content: "",
  isCustom: true,
});

const skillMatchesQuery = (
  skill: SkillCatalogEntry,
  query: string,
  selectedCategories: readonly string[],
) => {
  const matchesSearch =
    !query ||
    skill.title.toLowerCase().includes(query) ||
    skill.description.toLowerCase().includes(query) ||
    skill.tags.some((tag) => tag.toLowerCase().includes(query));
  const matchesCategory =
    selectedCategories.length === 0 ||
    selectedCategories.includes(skill.category);
  return matchesSearch && matchesCategory;
};

const SkillEditorModal = ({
  skill,
  onClose,
  onSave,
  onDelete,
  locale,
}: {
  skill?: TextSkill;
  onClose: () => void;
  onSave: (skill: TextSkill) => void;
  onDelete?: (skillId: string) => void;
  locale: string;
}) => {
  const t = useTranslations("Skill");
  const [draft, setDraft] = useState<TextSkill>(
    skill || createDefaultSkill(locale),
  );
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState("");
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const tagInputId = `${id}-tag-input`;

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, []);

  const updateDraft = (updates: Partial<TextSkill>) =>
    setDraft((current) => ({ ...current, ...updates }));

  const addTag = () => {
    const tag = tagInput.trim().slice(0, MARKET_LIMITS.maxSkillTagChars);
    if (
      tag &&
      draft.tags.length < MARKET_LIMITS.maxSkillTags &&
      !draft.tags.some((item) => item.toLowerCase() === tag.toLowerCase())
    ) {
      updateDraft({ tags: [...draft.tags, tag] });
      setTagInput("");
    }
  };

  const handleSave = () => {
    const id = skill?.id || slugifySkillId(draft.id || draft.title);
    const isBuiltInOverride = skill?.builtIn === true;
    const normalized = normalizeTextSkill({
      ...draft,
      id,
      name: slugifySkillId(draft.name || id),
      title: draft.title.trim() || titleCaseCategoryName(id),
      description: draft.description.trim(),
      content: draft.content.trim(),
      language: draft.language || createDefaultSkill(locale).language,
      activation: {
        ...draft.activation,
        embeddingText:
          draft.activation.embeddingText.trim() ||
          [draft.title, draft.description, ...draft.tags].join(" "),
      },
      builtIn: isBuiltInOverride,
      isCustom: true,
    });

    if (!normalized) {
      setError(t("invalidCustomSkill"));
      return;
    }
    if (
      (normalized.parameters || []).length !== (draft.parameters || []).length
    ) {
      setError(t("parameters.invalid"));
      return;
    }

    onSave({
      ...normalized,
      builtIn: isBuiltInOverride || undefined,
      isCustom: true,
    });
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    trapModalFocus(event, dialogRef.current);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm animate-in fade-in duration-200"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-4 overflow-hidden overscroll-contain rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-border dark:bg-card sm:max-h-[90vh]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id={titleId}
            className="flex min-w-0 items-center gap-2 truncate text-lg font-bold text-gray-800 dark:text-foreground"
          >
            <ScrollText size={20} className="text-emerald-500" />
            {skill ? t("editSkill") : t("createSkill")}
          </h2>
          <Button
            variant="bare"
            ref={closeButtonRef}
            type="button"
            aria-label={t("closeEditor")}
            onClick={onClose}
            className="rounded-full p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:hover:bg-muted"
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto pr-1 custom-scrollbar md:grid-cols-2">
          {!skill && (
            <label className="space-y-1 text-sm font-medium text-gray-700 dark:text-foreground/85">
              <span>{t("skillId")}</span>
              <input
                type="text"
                name="skill-id"
                autoComplete="off"
                spellCheck={false}
                value={draft.id}
                onChange={(event) => updateDraft({ id: event.target.value })}
                placeholder="custom-writing-helper"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 dark:border-border dark:bg-muted"
              />
            </label>
          )}
          <label className="space-y-1 text-sm font-medium text-gray-700 dark:text-foreground/85">
            <span>{t("skillTitle")}</span>
            <input
              type="text"
              name="skill-title"
              autoComplete="off"
              value={draft.title}
              onChange={(event) => updateDraft({ title: event.target.value })}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 dark:border-border dark:bg-muted"
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-gray-700 dark:text-foreground/85">
            <span>{t("category")}</span>
            <input
              type="text"
              name="skill-category"
              autoComplete="off"
              spellCheck={false}
              value={draft.category}
              onChange={(event) =>
                updateDraft({ category: event.target.value })
              }
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 dark:border-border dark:bg-muted"
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-gray-700 dark:text-foreground/85 md:col-span-2">
            <span>{t("skillDescription")}</span>
            <textarea
              name="skill-description"
              value={draft.description}
              onChange={(event) =>
                updateDraft({ description: event.target.value })
              }
              className="h-20 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 dark:border-border dark:bg-muted"
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-gray-700 dark:text-foreground/85 md:col-span-2">
            <span>{t("skillInstructions")}</span>
            <textarea
              name="skill-instructions"
              value={draft.content}
              onChange={(event) => updateDraft({ content: event.target.value })}
              className="h-28 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 dark:border-border dark:bg-muted"
            />
          </label>
          <SkillParameterEditor
            parameters={draft.parameters || []}
            onChange={(parameters) => updateDraft({ parameters })}
          />
          <div className="space-y-2 md:col-span-2">
            <label
              htmlFor={tagInputId}
              className="text-sm font-medium text-gray-700 dark:text-foreground/85"
            >
              {t("tags")}
            </label>
            <div className="flex gap-2">
              <input
                id={tagInputId}
                type="text"
                name="skill-tag"
                autoComplete="off"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder={t("tagPlaceholder")}
                className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 dark:border-border dark:bg-muted"
              />
              <Button
                variant="bare"
                type="button"
                aria-label={t("addTagAria")}
                onClick={addTag}
                className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:bg-emerald-900/20 dark:text-emerald-300"
              >
                <Plus size={16} aria-hidden="true" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {draft.tags.map((tag) => (
                <Button
                  variant="bare"
                  key={tag}
                  type="button"
                  aria-label={t("removeTagAria", { tag })}
                  onClick={() =>
                    updateDraft({
                      tags: draft.tags.filter((item) => item !== tag),
                    })
                  }
                  className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:bg-muted dark:text-foreground/80"
                >
                  {tag}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300"
          >
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-2">
          {skill && onDelete ? (
            <Button
              variant="bare"
              type="button"
              onClick={() => {
                if (!isDeleteConfirming) {
                  setIsDeleteConfirming(true);
                  return;
                }
                onDelete(skill.id);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 dark:text-red-300 dark:hover:bg-red-900/20"
            >
              <Trash2 size={14} aria-hidden="true" />
              {isDeleteConfirming ? t("confirmDelete") : t("delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="bare"
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-foreground/85 dark:hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              variant="bare"
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <Save size={14} aria-hidden="true" />
              {t("save")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const SkillCard = ({
  skill,
  mode,
  categoryLabel,
  isBusy = false,
  isUninstallConfirming = false,
  onInstall,
  onUninstall,
  onEdit,
}: {
  skill: SkillCatalogEntry | TextSkill;
  mode: "installed" | "available";
  categoryLabel: string;
  isBusy?: boolean;
  isUninstallConfirming?: boolean;
  onInstall?: () => void;
  onUninstall?: () => void;
  onEdit?: () => void;
}) => {
  const t = useTranslations("Skill");
  const isInstalled = mode === "installed";

  return (
    <div className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white/40 p-4 backdrop-blur-md transition-[border-color,box-shadow] duration-300 hover:border-emerald-300 dark:border-border dark:bg-muted/40 dark:hover:border-emerald-700">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="w-fit max-w-full truncate rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
            {categoryLabel}
          </span>
          <div className="flex flex-wrap gap-1">
            {skill.isCustom ? (
              <span className="w-fit rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500 dark:bg-accent dark:text-muted-foreground">
                {t("custom")}
              </span>
            ) : null}
            {isInstalled ? (
              <span className="w-fit rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                {t("installed")}
              </span>
            ) : null}
          </div>
        </div>
        {isInstalled ? (
          <Check size={16} className="shrink-0 text-emerald-500" />
        ) : null}
      </div>
      <h3 className="mb-1 truncate text-sm font-semibold text-gray-800 dark:text-foreground">
        {skill.title}
      </h3>
      <p className="mb-3 line-clamp-3 flex-1 text-xs leading-relaxed text-gray-500 dark:text-muted-foreground">
        {skill.description}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1">
          {skill.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="max-w-20 truncate rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-muted dark:text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isInstalled ? (
            <>
              <Button
                variant="bare"
                type="button"
                onClick={onEdit}
                className="rounded-lg px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
              >
                {t("edit")}
              </Button>
              <Button
                variant="bare"
                type="button"
                aria-label={t("uninstallSkillAria", { title: skill.title })}
                onClick={onUninstall}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                <Trash2 size={13} aria-hidden="true" />
                {isUninstallConfirming ? t("confirmUninstall") : t("uninstall")}
              </Button>
            </>
          ) : (
            <Button
              variant="bare"
              type="button"
              aria-label={t("installSkillAria", { title: skill.title })}
              aria-busy={isBusy || undefined}
              onClick={onInstall}
              disabled={isBusy}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? (
                <Loader2
                  size={13}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Download size={13} aria-hidden="true" />
              )}
              {t("install")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

const SkillMarket: React.FC<SkillMarketProps> = ({ onClose }) => {
  const t = useTranslations("Skill");
  const locale = useLocale();
  const {
    installedSkills,
    installSkill,
    uninstallSkill,
    updateInstalledSkill,
    addCustomSkill,
    removeCustomSkill,
    skillBundles,
    activeSkillBundleIds,
    addSkillBundle,
    updateSkillBundle,
    removeSkillBundle,
    toggleSkillBundleActive,
  } = useSettingsStore();

  const [builtInSkills, setBuiltInSkills] = useState<SkillCatalogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketLoadResult, setMarketLoadResult] = useState<
    MarketLoadResult<unknown> | undefined
  >();
  const [installingSkillIds, setInstallingSkillIds] = useState<string[]>([]);
  const [installError, setInstallError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [editingSkill, setEditingSkill] = useState<TextSkill | undefined>();
  const [showEditor, setShowEditor] = useState(false);
  const [editingBundle, setEditingBundle] = useState<SkillBundle | undefined>();
  const [showBundleEditor, setShowBundleEditor] = useState(false);
  const [uninstallConfirmingSkillId, setUninstallConfirmingSkillId] = useState<
    string | null
  >(null);
  const isMountedRef = useRef(true);
  const requestRef = useRef(0);
  const searchInputId = useId();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const loadSkills = useCallback(
    async (forceRefresh = false) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      if (forceRefresh) setIsRefreshing(true);
      else {
        setIsLoading(true);
        setMarketLoadResult(undefined);
      }
      try {
        const result = await fetchSkillCatalogResult(locale, forceRefresh);
        if (isMountedRef.current && requestRef.current === requestId) {
          if (result.status !== "error") {
            setBuiltInSkills(result.data.skills);
          }
          setMarketLoadResult(result);
        }
      } catch (error) {
        logDevError("Failed to load skills:", error);
      } finally {
        if (isMountedRef.current && requestRef.current === requestId) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [locale],
  );

  useEffect(() => {
    void loadSkills(false);
  }, [loadSkills]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategories]);

  const query = searchTerm.trim().toLowerCase();
  const installedIdSet = useMemo(
    () => new Set(installedSkills.map((skill) => skill.id)),
    [installedSkills],
  );
  useEffect(() => {
    if (
      uninstallConfirmingSkillId &&
      !installedIdSet.has(uninstallConfirmingSkillId)
    ) {
      setUninstallConfirmingSkillId(null);
    }
  }, [installedIdSet, uninstallConfirmingSkillId]);

  const installingIdSet = useMemo(
    () => new Set(installingSkillIds),
    [installingSkillIds],
  );
  const categories = useMemo(
    () =>
      Array.from(
        new Set([
          ...builtInSkills.map((skill) => skill.category),
          ...installedSkills.map((skill) => skill.category),
        ]),
      ).sort(),
    [builtInSkills, installedSkills],
  );
  const filteredInstalledSkills = useMemo(
    () =>
      [...installedSkills]
        .filter((skill) => skillMatchesQuery(skill, query, selectedCategories))
        .sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
        ),
    [installedSkills, query, selectedCategories],
  );
  const filteredBuiltInSkills = useMemo(
    () =>
      builtInSkills
        .filter((skill) => !installedIdSet.has(skill.id))
        .filter((skill) => skillMatchesQuery(skill, query, selectedCategories)),
    [builtInSkills, installedIdSet, query, selectedCategories],
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredBuiltInSkills.length / ITEMS_PER_PAGE),
  );
  const paginatedSkills = filteredBuiltInSkills.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const handleSaveSkill = (skill: TextSkill) => {
    if (installedIdSet.has(skill.id)) {
      updateInstalledSkill(skill.id, skill);
    } else {
      addCustomSkill(skill);
    }
  };

  const handleSaveBundle = (bundle: SkillBundle) => {
    if (skillBundles.some((item) => item.id === bundle.id)) {
      updateSkillBundle(bundle.id, bundle);
    } else {
      addSkillBundle(bundle);
    }
  };

  const handleInstallSkill = async (skill: SkillCatalogEntry) => {
    setInstallError("");
    setUninstallConfirmingSkillId(null);
    setInstallingSkillIds((current) =>
      current.includes(skill.id) ? current : [...current, skill.id],
    );
    try {
      const definition = await fetchSkillDefinition(skill, locale);
      if (!isMountedRef.current) return;
      if (!definition) {
        setInstallError(t("installFailed"));
        return;
      }
      installSkill({
        ...definition,
        builtIn: true,
        isCustom: undefined,
      });
    } catch (error) {
      logDevError("Failed to install skill:", error);
      if (isMountedRef.current) setInstallError(t("installFailed"));
    } finally {
      if (isMountedRef.current) {
        setInstallingSkillIds((current) =>
          current.filter((id) => id !== skill.id),
        );
      }
    }
  };

  const confirmUninstallSkill = (skillId: string) => {
    setInstallError("");
    if (uninstallConfirmingSkillId === skillId) {
      uninstallSkill(skillId);
      setUninstallConfirmingSkillId(null);
      return;
    }
    setUninstallConfirmingSkillId(skillId);
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  };

  const renderCategoryFilter = () => (
    <div className="relative shrink-0">
      <DropdownMenu
        open={showCategoryFilter}
        onOpenChange={setShowCategoryFilter}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="bare"
            type="button"
            aria-label={
              selectedCategories.length > 0
                ? t("filterCategorySelectedAria", {
                    count: selectedCategories.length,
                  })
                : t("filterCategoryAria")
            }
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              selectedCategories.length > 0
                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300"
                : "bg-transparent text-gray-600 hover:bg-gray-100 dark:text-foreground/85 dark:hover:bg-muted"
            }`}
          >
            <Filter size={12} aria-hidden="true" />
            <span>
              {selectedCategories.length > 0
                ? t("selectedCount", {
                    count: selectedCategories.length,
                  })
                : t("filter")}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          className="max-h-80 w-64 overflow-y-auto custom-scrollbar"
        >
          {selectedCategories.length > 0 && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setSelectedCategories([])}
            >
              {t("clearSelection")}
            </DropdownMenuItem>
          )}
          {categories.map((category) => (
            <DropdownMenuCheckboxItem
              key={category}
              checked={selectedCategories.includes(category)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => toggleCategory(category)}
            >
              <span className="truncate">
                {formatCategoryName(category, t)}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const marketNoticeMessage = (() => {
    if (marketLoadResult?.status === "stale") {
      const time = marketLoadResult.fetchedAt
        ? new Date(marketLoadResult.fetchedAt).toLocaleString(locale)
        : t("unknownCacheTime");
      const staleMessage = t("staleData", { time });
      return marketLoadResult.fallbackFrom
        ? `${t("englishFallback")} ${staleMessage}`
        : staleMessage;
    }
    if (marketLoadResult?.status === "fallback") {
      return t("englishFallback");
    }
    if (marketLoadResult?.status === "error") return t("loadFailed");
    return "";
  })();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden animate-in fade-in duration-300">
      {showEditor && (
        <SkillEditorModal
          skill={editingSkill}
          onClose={() => setShowEditor(false)}
          onSave={handleSaveSkill}
          onDelete={
            editingSkill?.isCustom && !editingSkill.builtIn
              ? removeCustomSkill
              : undefined
          }
          locale={locale}
        />
      )}
      {showBundleEditor ? (
        <SkillBundleEditor
          bundle={editingBundle}
          skills={installedSkills}
          onClose={() => setShowBundleEditor(false)}
          onSave={handleSaveBundle}
          onDelete={editingBundle ? removeSkillBundle : undefined}
        />
      ) : null}

      <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-gray-200/50 bg-white/40 px-6 py-4 backdrop-blur-md dark:border-border dark:bg-card/40">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-tr from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/20"
            aria-hidden="true"
          >
            <ScrollText size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-gray-800 dark:text-foreground">
              {t("title")}
            </h1>
            <p className="truncate text-xs text-gray-500 dark:text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="bare"
            type="button"
            aria-label={t("refreshAria")}
            aria-busy={isRefreshing || undefined}
            onClick={() => void loadSkills(true)}
            disabled={isRefreshing}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:text-muted-foreground dark:hover:bg-accent/50"
          >
            {isRefreshing ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={18} aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="bare"
            type="button"
            aria-label={t("closeMarket")}
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-muted-foreground dark:hover:bg-accent/50"
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {marketNoticeMessage ? (
        <div className="mx-6 mt-4">
          <MarketLoadNotice
            status={marketLoadResult?.status}
            message={marketNoticeMessage}
            retryLabel={t("retry")}
            onRetry={() => void loadSkills(true)}
            isRetrying={isRefreshing}
          />
        </div>
      ) : null}

      {/* Search Bar */}
      <div className="mx-auto flex w-full max-w-7xl shrink-0 flex-wrap gap-3 px-6 pb-6 pt-6">
        <div className="group relative min-w-0 flex-1">
          <div className="absolute inset-0 rounded-2xl bg-emerald-500/20 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100 dark:bg-emerald-500/10" />
          <div className="relative flex items-center rounded-2xl border border-gray-200 bg-white/60 px-4 py-3 shadow-sm backdrop-blur-xl transition-[border-color,box-shadow] focus-within:border-emerald-500/50 focus-within:ring-2 focus-within:ring-emerald-500/30 dark:border-border dark:bg-muted/60">
            <label htmlFor={searchInputId} className="sr-only">
              {t("searchLabel")}
            </label>
            <Search size={20} className="mr-3 text-gray-400" />
            <input
              id={searchInputId}
              type="search"
              name="skill-search"
              autoComplete="off"
              spellCheck={false}
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="min-w-0 flex-1 border-none bg-transparent text-base text-gray-800 outline-none placeholder-gray-400 dark:text-foreground"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 custom-scrollbar">
        <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-8">
          {installError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
            >
              {installError}
            </div>
          ) : null}

          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-gray-800 dark:text-foreground">
                  <Layers3 size={16} className="text-cyan-500" />
                  {t("bundles.heading")}
                </h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-muted-foreground">
                  {t("bundles.headingDescription")}
                </p>
              </div>
              <Button
                variant="bare"
                type="button"
                onClick={() => {
                  setEditingBundle(undefined);
                  setShowBundleEditor(true);
                }}
                disabled={installedSkills.length === 0}
                className="inline-flex items-center gap-1 rounded-lg bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-700 transition-colors hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 disabled:opacity-50 dark:bg-cyan-950/30 dark:text-cyan-300"
              >
                <Plus size={14} aria-hidden="true" />
                {t("bundles.new")}
              </Button>
            </div>
            {skillBundles.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {skillBundles.map((bundle) => {
                  const missingSkills = bundle.steps.filter(
                    (step) => !installedIdSet.has(step.skillId),
                  );
                  const isActive = activeSkillBundleIds.includes(bundle.id);
                  return (
                    <div
                      key={bundle.id}
                      className="flex flex-col rounded-2xl border border-cyan-100 bg-cyan-50/30 p-4 dark:border-cyan-900/40 dark:bg-cyan-950/10"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-foreground">
                            {bundle.title}
                          </h3>
                          <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-muted-foreground">
                            {bundle.description ||
                              t("bundles.stepCount", {
                                count: bundle.steps.length,
                              })}
                          </p>
                        </div>
                        <Button
                          variant="bare"
                          type="button"
                          role="switch"
                          aria-checked={isActive}
                          disabled={missingSkills.length > 0}
                          onClick={() => toggleSkillBundleActive(bundle.id)}
                          className={`rounded-full px-2 py-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 disabled:opacity-50 ${isActive ? "bg-cyan-600 text-white" : "bg-gray-100 text-gray-500 dark:bg-muted dark:text-muted-foreground"}`}
                        >
                          {isActive
                            ? t("bundles.active")
                            : t("bundles.inactive")}
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {bundle.steps.map((step, index) => (
                          <span
                            key={step.id}
                            className={`rounded px-1.5 py-0.5 text-[10px] ${installedIdSet.has(step.skillId) ? "bg-white text-gray-600 dark:bg-card dark:text-foreground/75" : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300"}`}
                          >
                            {index + 1}. {step.skillId}
                          </span>
                        ))}
                      </div>
                      {missingSkills.length > 0 ? (
                        <p className="mt-2 text-[11px] text-red-600 dark:text-red-300">
                          {t("bundles.invalidMissing")}
                        </p>
                      ) : null}
                      <Button
                        variant="bare"
                        type="button"
                        onClick={() => {
                          setEditingBundle(bundle);
                          setShowBundleEditor(true);
                        }}
                        className="mt-4 self-end rounded-lg px-2 py-1 text-xs font-medium text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 dark:text-cyan-300 dark:hover:bg-cyan-950/30"
                      >
                        {t("edit")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-cyan-200 px-4 py-8 text-center text-xs text-gray-500 dark:border-cyan-900/50 dark:text-muted-foreground">
                {t("bundles.none")}
              </div>
            )}
          </section>

          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
              <h2 className="flex min-w-0 items-center gap-2 truncate text-sm font-bold uppercase tracking-wider text-gray-800 dark:text-foreground">
                <ScrollText size={16} className="text-emerald-500" />
                <span className="truncate">{t("installedSkills")}</span>
              </h2>
              <Button
                variant="bare"
                type="button"
                aria-label={t("createCustomAria")}
                onClick={() => {
                  setEditingSkill(undefined);
                  setShowEditor(true);
                }}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:bg-emerald-900/20 dark:text-emerald-300"
              >
                <Plus size={14} aria-hidden="true" /> {t("custom")}
              </Button>
            </div>
            {filteredInstalledSkills.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredInstalledSkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    mode="installed"
                    categoryLabel={formatCategoryName(skill.category, t)}
                    isUninstallConfirming={
                      uninstallConfirmingSkillId === skill.id
                    }
                    onUninstall={() => confirmUninstallSkill(skill.id)}
                    onEdit={() => {
                      setUninstallConfirmingSkillId(null);
                      setEditingSkill(skill);
                      setShowEditor(true);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-gray-400">
                {t("noInstalledSkills")}
              </div>
            )}
          </section>

          {/* Available Section */}
          <section className="flex flex-1 flex-col">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
              <h2 className="min-w-0 truncate text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-muted-foreground">
                {searchTerm ? t("searchResults") : t("allSkills")}
              </h2>
              {renderCategoryFilter()}
            </div>
            {isLoading ? (
              <div
                role="status"
                aria-live="polite"
                className="flex h-64 flex-col items-center justify-center gap-4 text-gray-400"
              >
                <Loader2
                  size={32}
                  className="animate-spin text-emerald-500"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium">{t("loading")}</span>
              </div>
            ) : (
              <>
                <div className="grid flex-1 grid-cols-1 content-start gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {paginatedSkills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      mode="available"
                      categoryLabel={formatCategoryName(skill.category, t)}
                      isBusy={installingIdSet.has(skill.id)}
                      onInstall={() => void handleInstallSkill(skill)}
                    />
                  ))}
                </div>
                {paginatedSkills.length === 0 &&
                  marketLoadResult &&
                  ["fresh", "cache", "fallback"].includes(
                    marketLoadResult.status,
                  ) && (
                    <div className="py-12 text-center text-gray-400">
                      {t("noSkillsFound")}
                    </div>
                  )}
                {totalPages > 1 && (
                  <div className="mt-auto flex items-center justify-center gap-4 py-6">
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("prevPageAria")}
                      onClick={() =>
                        setCurrentPage((page) => Math.max(1, page - 1))
                      }
                      disabled={currentPage === 1}
                      className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-muted dark:text-foreground/85 dark:hover:bg-accent"
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </Button>
                    <span className="text-sm font-medium tabular-nums text-gray-600 dark:text-foreground/85">
                      {t("pageOf", { currentPage, totalPages })}
                    </span>
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("nextPageAria")}
                      onClick={() =>
                        setCurrentPage((page) => Math.min(totalPages, page + 1))
                      }
                      disabled={currentPage === totalPages}
                      className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-muted dark:text-foreground/85 dark:hover:bg-accent"
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default SkillMarket;
