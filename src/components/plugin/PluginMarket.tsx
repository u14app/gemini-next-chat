"use client";
import React, { useState, useEffect, useMemo, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  Search,
  Download,
  Trash2,
  Loader2,
  Cable,
  ExternalLink,
  X,
  ChevronLeft,
  ChevronRight,
  Filter,
  Check,
  Settings,
  KeyRound,
  ShieldAlert,
  AlertTriangle,
  Save,
  Plus,
  Zap,
  RefreshCw,
} from "lucide-react";
import { useSettingsStore } from "@/store/core/settingsStore";
import {
  fetchApiGuruListResult,
  fetchMcpServerPageResult,
  getCachedMcpServers,
  getCachedPlugins,
  discoverMcpBridgeServers,
  installPlugin,
  installCustomPlugin,
  installCustomMcpServer,
  type BridgeDiscoveredServer,
} from "@/services/api/pluginService";
import { Plugin } from "@/types";
import SafeImage from "@/components/ui/SafeImage";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getSafeWebHref } from "@/lib/security/clientUrl";
import { ResearchSourceCredentials } from "./ResearchSourceCredentials";
import { isResearchSourceProvider } from "@/lib/plugin/researchSources/catalog";
import { localizePluginMeta } from "@/lib/plugin/localizedMeta";
import { isPluginAuthRequired } from "@/lib/plugin/config";
import { PLUGIN_CONFIG_LIMITS } from "@/config/limits";
import { hasPluginAuthValue } from "@/lib/security/localSecretResolvers";
import { SecretInput } from "@/components/ui/controls";
import {
  encryptLocalSecret,
  LOCAL_SECRET_CONTEXTS,
} from "@/lib/security/localSecrets";
import type { MarketLoadResult } from "@/lib/market/loadResult";
import MarketLoadNotice from "@/components/ui/MarketLoadNotice";
import { Button } from "@/components/ui/primitives";

interface PluginMarketProps {
  onClose: () => void;
}

type MarketSource = "plugins" | "mcp";

const ITEMS_PER_PAGE = 20;
const CUSTOM_PLUGIN_INPUT_MAX_CHARS = 2_000_000;
const isBrowserOnline = () =>
  typeof navigator === "undefined" || navigator.onLine;
const ENDPOINT_CONFIG_PLUGIN_IDS = new Set([
  "openai-image-generation",
  "gemini-image-generation",
  "openai-responses-image-processing",
]);
const ENDPOINT_PLACEHOLDERS: Record<string, string> = {
  "openai-image-generation": "https://api.example.com/v1",
  "gemini-image-generation": "https://generativelanguage.googleapis.com",
  "openai-responses-image-processing": "https://api.openai.com/v1",
};
const MODEL_CONFIG_PLUGIN_IDS = new Set([
  "agnes-image-generation",
  "agnes-video-generation",
  "gemini-image-generation",
  "openai-image-generation",
  "openai-responses-image-processing",
]);
const MODEL_PLACEHOLDERS: Record<string, string> = {
  "agnes-image-generation": "agnes-image-2.1-flash",
  "agnes-video-generation": "agnes-video-v2.0",
  "gemini-image-generation": "gemini-3.1-flash-image",
  "openai-image-generation": "gpt-image-1",
  "openai-responses-image-processing": "gpt-image-1.5",
};

function getEndpointPlaceholder(pluginId: string, fallback: string) {
  return ENDPOINT_PLACEHOLDERS[pluginId] || fallback;
}

function getModelPlaceholder(pluginId: string, fallback: string) {
  return MODEL_PLACEHOLDERS[pluginId] || fallback;
}

// Helper to format category names (replace _ with space, title case)
const formatCategoryName = (str: string) => {
  return str
    .replace(/_/g, " ")
    .replace(
      /\b\w/g,
      (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(),
    );
};

// Helper to format tool names (remove underscores, camelCase to space, title case)
const formatToolName = (name: string) => {
  return name
    .replace(/_/g, " ") // Replace underscores with spaces
    .replace(/([a-z])([A-Z])/g, "$1 $2") // Insert space before capital letters (camelCase)
    .replace(/\b\w/g, (l) => l.toUpperCase()); // Capitalize first letter of each word
};

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

const Switch = ({
  checked,
  onChange,
  size = "md",
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  size?: "sm" | "md";
  disabled?: boolean;
  ariaLabel: string;
}) => {
  const sizeClasses =
    size === "sm"
      ? "w-7 h-4 after:h-3 after:w-3 after:top-[2px] after:left-[2px]"
      : "w-9 h-5 after:h-4 after:w-4 after:top-[2px] after:left-[2px]";

  return (
    <label
      className={`relative inline-flex shrink-0 items-center ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <div
        className={`${sizeClasses} rounded-full bg-gray-200 transition-[background-color,box-shadow] peer-checked:bg-green-500 peer-focus-visible:ring-2 peer-focus-visible:ring-green-500/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white after:absolute after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-transform after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-accent dark:peer-checked:bg-emerald-400 dark:peer-checked:shadow-[0_0_0_3px_rgba(52,211,153,0.22)] dark:peer-focus-visible:ring-offset-background`}
      />
    </label>
  );
};

const CustomPluginModal = ({
  onClose,
  onInstall,
}: {
  onClose: () => void;
  onInstall: (plugin: Plugin) => void;
}) => {
  const t = useTranslations("Plugin");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const installRequestRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const descriptionId = `${modalId}-description`;
  const inputId = `${modalId}-openapi-input`;
  const errorId = `${modalId}-error`;

  useEffect(() => {
    isMountedRef.current = true;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      isMountedRef.current = false;
      installRequestRef.current += 1;
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, []);

  const handleClose = () => {
    if (!isLoading) onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
      return;
    }

    trapModalFocus(event, dialogRef.current);
  };

  const handleInstall = async () => {
    if (!input.trim()) return;
    const requestId = installRequestRef.current + 1;
    installRequestRef.current = requestId;
    setIsLoading(true);
    setError(null);
    try {
      const plugin = await installCustomPlugin(input);
      if (!isMountedRef.current || installRequestRef.current !== requestId) {
        return;
      }
      onInstall(plugin);
      onClose();
    } catch (e) {
      if (isMountedRef.current && installRequestRef.current === requestId) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isMountedRef.current && installRequestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-border dark:bg-card"
      >
        <div className="flex justify-between items-center">
          <h2
            id={titleId}
            className="flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-foreground"
          >
            <Cable size={20} className="text-blue-500" aria-hidden="true" />
            {t("addCustomPlugin")}
          </h2>
          <Button
            variant="bare"
            ref={closeButtonRef}
            type="button"
            aria-label={t("closeCustomInstaller")}
            onClick={handleClose}
            className="rounded-full p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-muted"
            disabled={isLoading}
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>

        <div className="space-y-2">
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-gray-700 dark:text-foreground/85"
          >
            {t("openApiSpecLabel")}
          </label>
          <textarea
            id={inputId}
            name="custom-plugin-openapi"
            aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ""}`}
            className="w-full h-40 p-3 bg-gray-50 dark:bg-muted border border-gray-200 dark:border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-xs font-mono resize-none custom-scrollbar"
            placeholder={t("openApiPlaceholder")}
            value={input}
            maxLength={CUSTOM_PLUGIN_INPUT_MAX_CHARS}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
          />
          <p id={descriptionId} className="text-[10px] text-gray-500">
            {t("openApiHint")}
          </p>
        </div>

        {error && (
          <div
            id={errorId}
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400"
          >
            <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="bare"
            type="button"
            onClick={handleClose}
            disabled={isLoading}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:text-muted-foreground dark:hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            variant="bare"
            type="button"
            aria-label={t("installCustomAria")}
            aria-busy={isLoading || undefined}
            onClick={handleInstall}
            disabled={isLoading || !input.trim()}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
            {t("install")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const McpInstallAuthModal = ({
  plugin,
  onClose,
  onInstall,
}: {
  plugin: Plugin;
  onClose: () => void;
  onInstall: (authValue: string) => Promise<string | null>;
}) => {
  const t = useTranslations("Plugin");
  const [authValue, setAuthValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const descriptionId = `${modalId}-description`;
  const inputId = `${modalId}-auth-input`;
  const errorId = `${modalId}-error`;

  useEffect(() => {
    isMountedRef.current = true;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      isMountedRef.current = false;
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, []);

  const handleClose = () => {
    if (!isLoading) onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
      return;
    }

    trapModalFocus(event, dialogRef.current);
  };

  const handleInstall = async () => {
    const normalizedAuthValue = authValue.trim();
    if (!normalizedAuthValue || isLoading) return;

    setIsLoading(true);
    setError(null);
    try {
      const installError = await onInstall(normalizedAuthValue);
      if (!isMountedRef.current) return;
      if (installError) {
        setError(installError);
        return;
      }
      onClose();
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-border dark:bg-card"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id={titleId}
            className="flex min-w-0 items-center gap-2 text-lg font-bold text-gray-800 dark:text-foreground"
          >
            <KeyRound
              size={20}
              className="shrink-0 text-blue-500"
              aria-hidden="true"
            />
            <span className="truncate">{t("mcpInstallAuthTitle")}</span>
          </h2>
          <Button
            variant="bare"
            ref={closeButtonRef}
            type="button"
            aria-label={t("closeMcpAuthInstaller")}
            onClick={handleClose}
            disabled={isLoading}
            className="rounded-full p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-muted"
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>

        <p
          id={descriptionId}
          className="text-sm leading-relaxed text-gray-500 dark:text-muted-foreground"
        >
          {t("mcpInstallAuthDescription", { title: plugin.title })}
        </p>

        <div className="space-y-2">
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-gray-700 dark:text-foreground/85"
          >
            {t("mcpInstallAuthLabel")}
          </label>
          <input
            id={inputId}
            name={`mcp-install-auth-${plugin.id}`}
            type="password"
            value={authValue}
            onChange={(event) => setAuthValue(event.target.value)}
            maxLength={PLUGIN_CONFIG_LIMITS.maxAuthValueChars}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ""}`}
            placeholder={t("authPlaceholder")}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-800 transition-[background-color,border-color,box-shadow,color] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-muted dark:text-foreground"
          />
        </div>

        {error && (
          <div
            id={errorId}
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400"
          >
            <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="bare"
            type="button"
            onClick={handleClose}
            disabled={isLoading}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:text-muted-foreground dark:hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            variant="bare"
            type="button"
            aria-label={t("installPluginAria", { title: plugin.title })}
            aria-busy={isLoading || undefined}
            onClick={handleInstall}
            disabled={isLoading || !authValue.trim()}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
            {t("install")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const CustomMcpServerModal = ({
  onClose,
  onInstall,
  bridgeDiscoveryEnabled,
  isOnline,
}: {
  onClose: () => void;
  onInstall: (plugin: Plugin, bearerToken?: string) => Promise<void> | void;
  bridgeDiscoveryEnabled: boolean;
  isOnline: boolean;
}) => {
  const t = useTranslations("Plugin");
  const [name, setName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [bridgeManifestUrl, setBridgeManifestUrl] = useState("");
  const [bridgeToken, setBridgeToken] = useState("");
  const [bridgeServers, setBridgeServers] = useState<BridgeDiscoveredServer[]>(
    [],
  );
  const [importedBridgeIds, setImportedBridgeIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const installRequestRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const descriptionId = `${modalId}-description`;
  const nameInputId = `${modalId}-name`;
  const urlInputId = `${modalId}-url`;
  const tokenInputId = `${modalId}-token`;
  const bridgeSectionId = `${modalId}-bridge-section`;
  const bridgeUrlInputId = `${modalId}-bridge-url`;
  const bridgeTokenInputId = `${modalId}-bridge-token`;
  const errorId = `${modalId}-error`;

  useEffect(() => {
    isMountedRef.current = true;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      isMountedRef.current = false;
      installRequestRef.current += 1;
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, []);

  const handleClose = () => {
    if (!isLoading && !isDiscovering) onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
      return;
    }

    trapModalFocus(event, dialogRef.current);
  };

  const handleInstall = async () => {
    if (!isOnline || !isBrowserOnline() || !name.trim() || !serverUrl.trim()) {
      return;
    }
    const requestId = installRequestRef.current + 1;
    installRequestRef.current = requestId;
    setIsLoading(true);
    setError(null);

    try {
      const token = bearerToken.trim() || undefined;
      const plugin = await installCustomMcpServer({
        name,
        serverUrl,
        bearerToken: token,
      });
      if (!isMountedRef.current || installRequestRef.current !== requestId) {
        return;
      }
      await onInstall(plugin, token);
      if (!isMountedRef.current || installRequestRef.current !== requestId) {
        return;
      }
      onClose();
    } catch (e) {
      if (isMountedRef.current && installRequestRef.current === requestId) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isMountedRef.current && installRequestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  };

  const handleBridgeDiscovery = async () => {
    if (
      !isOnline ||
      !isBrowserOnline() ||
      !bridgeManifestUrl.trim() ||
      !bridgeToken.trim()
    ) {
      return;
    }
    const requestId = installRequestRef.current + 1;
    installRequestRef.current = requestId;
    setIsDiscovering(true);
    setError(null);

    try {
      const servers = await discoverMcpBridgeServers({
        manifestUrl: bridgeManifestUrl,
        bearerToken: bridgeToken,
      });
      if (!isMountedRef.current || installRequestRef.current !== requestId) {
        return;
      }
      setBridgeServers(servers);
      setImportedBridgeIds([]);
    } catch (e) {
      if (isMountedRef.current && installRequestRef.current === requestId) {
        setBridgeServers([]);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isMountedRef.current && installRequestRef.current === requestId) {
        setIsDiscovering(false);
      }
    }
  };

  const handleBridgeImport = async (server: BridgeDiscoveredServer) => {
    if (
      !isOnline ||
      !isBrowserOnline() ||
      importedBridgeIds.includes(server.id)
    ) {
      return;
    }
    const requestId = installRequestRef.current + 1;
    installRequestRef.current = requestId;
    setIsLoading(true);
    setError(null);

    try {
      const token = bridgeToken.trim();
      const plugin = await installCustomMcpServer({
        name: server.label,
        serverUrl: server.serverUrl,
        bearerToken: token,
        source: "bridge",
      });
      if (!isMountedRef.current || installRequestRef.current !== requestId) {
        return;
      }
      await onInstall(plugin, token);
      if (!isMountedRef.current || installRequestRef.current !== requestId) {
        return;
      }
      setImportedBridgeIds((ids) => [...ids, server.id]);
    } catch (e) {
      if (isMountedRef.current && installRequestRef.current === requestId) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isMountedRef.current && installRequestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="custom-scrollbar flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-border dark:bg-card"
      >
        <div className="flex justify-between items-center">
          <h2
            id={titleId}
            className="flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-foreground"
          >
            <Cable size={20} className="text-blue-500" aria-hidden="true" />
            {t("addCustomMcpServer")}
          </h2>
          <Button
            variant="bare"
            ref={closeButtonRef}
            type="button"
            aria-label={t("closeCustomMcpInstaller")}
            onClick={handleClose}
            className="rounded-full p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-muted"
            disabled={isLoading || isDiscovering}
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>

        {!isOnline && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <AlertTriangle
              size={14}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <span>{t("mcpOfflineUnavailable")}</span>
          </div>
        )}

        {bridgeDiscoveryEnabled && (
          <section
            aria-labelledby={bridgeSectionId}
            className="rounded-2xl border border-blue-200/80 bg-blue-50/60 p-4 dark:border-blue-400/20 dark:bg-blue-400/5"
          >
            <div className="mb-3 flex items-start gap-3">
              <span className="mt-0.5 rounded-lg bg-blue-600 p-1.5 text-white shadow-sm shadow-blue-500/20">
                <Zap size={14} aria-hidden="true" />
              </span>
              <div>
                <h3
                  id={bridgeSectionId}
                  className="text-sm font-semibold text-gray-800 dark:text-foreground"
                >
                  {t("bridgeDiscoveryTitle")}
                </h3>
                <p className="mt-0.5 text-[11px] leading-4 text-gray-500 dark:text-muted-foreground">
                  {t("bridgeDiscoveryHint")}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor={bridgeUrlInputId}
                  className="text-xs font-medium text-gray-700 dark:text-foreground/85"
                >
                  {t("bridgeManifestUrlLabel")}
                </label>
                <input
                  id={bridgeUrlInputId}
                  type="url"
                  name="mcp-bridge-manifest-url"
                  value={bridgeManifestUrl}
                  maxLength={2048}
                  autoComplete="off"
                  placeholder={t("bridgeManifestUrlPlaceholder")}
                  onChange={(event) => setBridgeManifestUrl(event.target.value)}
                  className="w-full rounded-xl border border-blue-200 bg-white px-3 py-2 font-mono text-xs text-gray-800 transition-[border-color,box-shadow] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-blue-400/20 dark:bg-background dark:text-foreground"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor={bridgeTokenInputId}
                  className="text-xs font-medium text-gray-700 dark:text-foreground/85"
                >
                  {t("bridgeTokenLabel")}
                </label>
                <input
                  id={bridgeTokenInputId}
                  type="password"
                  name="mcp-bridge-bearer-token"
                  value={bridgeToken}
                  maxLength={4096}
                  autoComplete="off"
                  placeholder={t("bridgeTokenPlaceholder")}
                  onChange={(event) => setBridgeToken(event.target.value)}
                  className="w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs text-gray-800 transition-[border-color,box-shadow] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-blue-400/20 dark:bg-background dark:text-foreground"
                />
              </div>

              <Button
                variant="bare"
                type="button"
                onClick={handleBridgeDiscovery}
                disabled={
                  !isOnline ||
                  isLoading ||
                  isDiscovering ||
                  !bridgeManifestUrl.trim() ||
                  !bridgeToken.trim()
                }
                aria-busy={isDiscovering || undefined}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-400/20 dark:bg-background dark:text-blue-300 dark:hover:bg-blue-400/10"
              >
                <RefreshCw
                  size={14}
                  className={isDiscovering ? "animate-spin" : ""}
                  aria-hidden="true"
                />
                {isDiscovering ? t("bridgeDiscovering") : t("bridgeDiscover")}
              </Button>

              {bridgeServers.length > 0 && (
                <ul
                  aria-label={t("bridgeServerListAria")}
                  className="space-y-2 border-t border-blue-200/70 pt-3 dark:border-blue-400/15"
                >
                  {bridgeServers.map((server) => {
                    const imported = importedBridgeIds.includes(server.id);
                    return (
                      <li
                        key={server.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-white/80 px-3 py-2 dark:bg-background/70"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-gray-800 dark:text-foreground">
                            {server.label}
                          </p>
                          <p className="truncate font-mono text-[10px] text-gray-500 dark:text-muted-foreground">
                            {server.id}
                          </p>
                        </div>
                        <Button
                          variant="bare"
                          type="button"
                          onClick={() => handleBridgeImport(server)}
                          disabled={
                            !isOnline || isLoading || isDiscovering || imported
                          }
                          aria-label={t("importBridgeServerAria", {
                            label: server.label,
                          })}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {imported ? (
                            <Check size={13} aria-hidden="true" />
                          ) : (
                            <Download size={13} aria-hidden="true" />
                          )}
                          {imported ? t("bridgeImported") : t("bridgeImport")}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor={nameInputId}
              className="text-sm font-medium text-gray-700 dark:text-foreground/85"
            >
              {t("mcpServerNameLabel")}
            </label>
            <input
              id={nameInputId}
              type="text"
              name="custom-mcp-name"
              value={name}
              maxLength={120}
              autoComplete="off"
              placeholder={t("mcpServerNamePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 transition-[border-color,box-shadow] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-muted dark:text-foreground"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor={urlInputId}
              className="text-sm font-medium text-gray-700 dark:text-foreground/85"
            >
              {t("mcpServerUrlLabel")}
            </label>
            <input
              id={urlInputId}
              type="url"
              name="custom-mcp-url"
              value={serverUrl}
              maxLength={2048}
              autoComplete="off"
              placeholder={t("mcpServerUrlPlaceholder")}
              aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ""}`}
              onChange={(event) => setServerUrl(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 font-mono text-sm text-gray-800 transition-[border-color,box-shadow] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-muted dark:text-foreground"
            />
            <p id={descriptionId} className="text-[10px] text-gray-500">
              {t("mcpServerUrlHint")}
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor={tokenInputId}
              className="text-sm font-medium text-gray-700 dark:text-foreground/85"
            >
              {t("mcpBearerTokenLabel")}
            </label>
            <input
              id={tokenInputId}
              type="password"
              name="custom-mcp-bearer-token"
              value={bearerToken}
              maxLength={PLUGIN_CONFIG_LIMITS.maxAuthValueChars}
              autoComplete="off"
              placeholder={t("mcpBearerTokenPlaceholder")}
              onChange={(event) => setBearerToken(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 transition-[border-color,box-shadow] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-muted dark:text-foreground"
            />
            <p className="text-[10px] text-gray-500">
              {t("mcpBearerTokenHint")}
            </p>
          </div>
        </div>

        {error && (
          <div
            id={errorId}
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400"
          >
            <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="bare"
            type="button"
            onClick={handleClose}
            disabled={isLoading || isDiscovering}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:text-muted-foreground dark:hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            variant="bare"
            type="button"
            aria-label={t("installCustomMcpAria")}
            aria-busy={isLoading || undefined}
            onClick={handleInstall}
            disabled={
              !isOnline ||
              isLoading ||
              isDiscovering ||
              !name.trim() ||
              !serverUrl.trim()
            }
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
            {t("install")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const PluginDetailsModal = ({
  plugin,
  onClose,
}: {
  plugin: Plugin;
  onClose: () => void;
}) => {
  const t = useTranslations("Plugin");
  const {
    pluginConfigs,
    updatePluginConfig,
    togglePluginFunction,
    removeInstalledPlugin,
    activePlugins,
    togglePluginActive,
  } = useSettingsStore();
  const tSource = useTranslations("ResearchSources");
  const config = pluginConfigs[plugin.id] || { disabledFunctions: [] };
  const disabledFunctions = config.disabledFunctions || [];

  const [activeTab, setActiveTab] = useState<"tools" | "auth">("tools");
  const [endpointValue, setEndpointValue] = useState(config.baseUrl || "");
  const [modelValue, setModelValue] = useState(config.model || "");
  const [isUninstallConfirming, setIsUninstallConfirming] = useState(false);
  const uninstallConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modalId = useId();
  const titleId = `${modalId}-title`;
  const descriptionId = `${modalId}-description`;
  const toolsTabId = `${modalId}-tools-tab`;
  const authTabId = `${modalId}-auth-tab`;
  const toolsPanelId = `${modalId}-tools-panel`;
  const authPanelId = `${modalId}-auth-panel`;
  const authInputId = `${modalId}-auth-input`;
  const authDescriptionId = `${modalId}-auth-description`;
  const safeManifestUrl = getSafeWebHref(plugin.manifestUrl);
  const safeDocsUrl = getSafeWebHref(plugin.externalDocsUrl);
  const pluginBaseUrl =
    plugin.source === "mcp"
      ? plugin.mcp?.serverUrl || t("notAvailable")
      : plugin.baseUrl || t("notAvailable");
  const pluginAuthType = plugin.auth?.type || "none";
  const pluginAuthLocation = plugin.auth?.in || "header";
  const supportsEndpointConfig = ENDPOINT_CONFIG_PLUGIN_IDS.has(plugin.id);
  const supportsModelConfig = MODEL_CONFIG_PLUGIN_IDS.has(plugin.id);

  const clearUninstallConfirmation = () => {
    if (uninstallConfirmTimerRef.current) {
      clearTimeout(uninstallConfirmTimerRef.current);
      uninstallConfirmTimerRef.current = null;
    }
    setIsUninstallConfirming(false);
  };

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      if (uninstallConfirmTimerRef.current) {
        clearTimeout(uninstallConfirmTimerRef.current);
        uninstallConfirmTimerRef.current = null;
      }
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, []);

  const handleSave = () => {
    clearUninstallConfirmation();
    onClose();
  };

  const handleSaveAuthSecret = async (value: string) => {
    const localValueSecret = await encryptLocalSecret(
      value,
      LOCAL_SECRET_CONTEXTS.pluginAuth(plugin.id),
    );
    updatePluginConfig(plugin.id, {
      auth: {
        type: plugin.auth?.type === "apiKey" ? "apiKey" : "bearer",
        value: "",
        ...(localValueSecret ? { localValueSecret } : {}),
        ...(config.auth?.key ? { key: config.auth.key } : {}),
        addTo: plugin.auth?.in || "header",
      },
    });

    if (
      !isResearchSourceProvider(plugin.id) &&
      !activePlugins.includes(plugin.id)
    ) {
      togglePluginActive(plugin.id);
    }
  };

  const handleClearAuthSecret = () => {
    updatePluginConfig(plugin.id, {
      auth: {
        type: plugin.auth?.type === "apiKey" ? "apiKey" : "bearer",
        value: "",
        ...(config.auth?.key ? { key: config.auth.key } : {}),
        addTo: plugin.auth?.in || "header",
      },
    });
  };

  const handleSaveEndpoint = () => {
    updatePluginConfig(plugin.id, {
      baseUrl: endpointValue,
    });
  };

  const handleClearEndpoint = () => {
    setEndpointValue("");
    updatePluginConfig(plugin.id, {
      baseUrl: "",
    });
  };

  const handleSaveModel = () => {
    updatePluginConfig(plugin.id, {
      model: modelValue,
    });
  };

  const handleClearModel = () => {
    setModelValue("");
    updatePluginConfig(plugin.id, {
      model: "",
    });
  };

  const handleClose = () => {
    clearUninstallConfirmation();
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
      return;
    }

    trapModalFocus(event, dialogRef.current);
  };

  const handleTabListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs: Array<{ value: "tools" | "auth"; id: string }> = [
      { value: "tools", id: toolsTabId },
      { value: "auth", id: authTabId },
    ];
    const currentIndex = tabs.findIndex((tab) => tab.value === activeTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab.value);
    document.getElementById(nextTab.id)?.focus({ preventScroll: true });
  };

  const handleUninstall = () => {
    if (plugin.builtIn) return;
    if (!isUninstallConfirming) {
      setIsUninstallConfirming(true);
      if (uninstallConfirmTimerRef.current) {
        clearTimeout(uninstallConfirmTimerRef.current);
      }
      uninstallConfirmTimerRef.current = setTimeout(() => {
        uninstallConfirmTimerRef.current = null;
        setIsUninstallConfirming(false);
      }, 5000);
      return;
    }

    clearUninstallConfirmation();
    removeInstalledPlugin(plugin.id);
    onClose();
  };

  const isPluginActive = activePlugins.includes(plugin.id);

  return createPortal(
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm animate-in fade-in duration-200 dark:bg-black/50"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden overscroll-contain rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-border dark:bg-card"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 bg-gray-50/50 px-6 py-4 dark:border-border dark:bg-card/50">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-white p-2 shadow-sm dark:border-border dark:bg-muted">
              <SafeImage
                src={plugin.logoUrl}
                alt=""
                className="w-full h-full object-contain"
                fallback={
                  <Cable
                    size={24}
                    className="text-gray-400"
                    aria-hidden="true"
                  />
                }
              />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="flex min-w-0 flex-wrap items-center gap-2 text-lg font-bold text-gray-800 dark:text-foreground"
              >
                <span className="min-w-0 truncate">{plugin.title}</span>
                {plugin.builtIn && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                    <Zap size={10} aria-hidden="true" /> {t("builtIn")}
                  </span>
                )}
                {isPluginActive && (
                  <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    {t("active")}
                  </span>
                )}
              </h2>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-muted-foreground">
                <span className="min-w-0 truncate">{plugin.id}</span>
                <span className="shrink-0">•</span>
                {safeManifestUrl ? (
                  <a
                    href={safeManifestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("openSpecAria", { title: plugin.title })}
                    className="flex shrink-0 items-center gap-1 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                  >
                    {t("openApiSpec")}{" "}
                    <ExternalLink size={10} aria-hidden="true" />
                  </a>
                ) : (
                  <span className="min-w-0 truncate">
                    {t("builtInDefinition")}
                  </span>
                )}
                {safeDocsUrl && (
                  <>
                    <span className="shrink-0">•</span>
                    <a
                      href={safeDocsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("openDocsAria", { title: plugin.title })}
                      className="flex shrink-0 items-center gap-1 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                    >
                      {t("docs")} <ExternalLink size={10} aria-hidden="true" />
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
          <Button
            variant="bare"
            ref={closeButtonRef}
            type="button"
            aria-label={t("closeDetails")}
            onClick={handleClose}
            className="shrink-0 rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:hover:bg-muted"
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>

        <div className="px-6 py-4 border-b border-gray-100 dark:border-border">
          <div className="max-h-40 overflow-y-auto custom-scrollbar pr-2">
            <p
              id={descriptionId}
              className="text-sm leading-relaxed text-gray-600 dark:text-foreground/85"
            >
              {plugin.description}
            </p>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-white/60 p-3 text-xs dark:border-border dark:bg-card/50 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="font-medium text-gray-500 dark:text-muted-foreground">
                {t("connectionBaseUrl")}
              </dt>
              <dd className="mt-1 truncate font-mono text-gray-800 dark:text-foreground">
                {pluginBaseUrl}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-medium text-gray-500 dark:text-muted-foreground">
                {t("connectionAuth")}
              </dt>
              <dd className="mt-1 truncate font-mono text-gray-800 dark:text-foreground">
                {pluginAuthType}
                {pluginAuthType !== "none" ? ` / ${pluginAuthLocation}` : ""}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-medium text-gray-500 dark:text-muted-foreground">
                {t("connectionTools")}
              </dt>
              <dd className="mt-1 truncate font-mono text-gray-800 dark:text-foreground">
                {plugin.functions?.length || 0}
              </dd>
            </div>
          </dl>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label={t("detailsSectionsAria")}
          onKeyDown={handleTabListKeyDown}
          className="flex border-b border-gray-100 px-6 dark:border-border"
        >
          <Button
            variant="bare"
            id={toolsTabId}
            type="button"
            role="tab"
            aria-selected={activeTab === "tools"}
            aria-controls={toolsPanelId}
            tabIndex={activeTab === "tools" ? 0 : -1}
            onClick={() => setActiveTab("tools")}
            className={`mr-6 border-b-2 px-1 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${activeTab === "tools" ? "border-blue-500 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-foreground/85"}`}
          >
            {t("toolsTab", { count: plugin.functions?.length || 0 })}
          </Button>
          <Button
            variant="bare"
            id={authTabId}
            type="button"
            role="tab"
            aria-selected={activeTab === "auth"}
            aria-controls={authPanelId}
            tabIndex={activeTab === "auth" ? 0 : -1}
            onClick={() => setActiveTab("auth")}
            className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${activeTab === "auth" ? "border-blue-500 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-foreground/85"}`}
          >
            {t("authTab")}
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30 dark:bg-background/60">
          {activeTab === "tools" && (
            <div
              id={toolsPanelId}
              role="tabpanel"
              aria-labelledby={toolsTabId}
              className="space-y-3"
            >
              {plugin.functions?.map((fn) => {
                const isEnabled = !disabledFunctions.includes(fn.name);
                return (
                  <div
                    key={fn.name}
                    className="flex items-start justify-between p-3 bg-white dark:bg-muted border border-gray-200 dark:border-border rounded-xl"
                  >
                    <div className="flex-1 pr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-sm font-semibold text-gray-800 dark:text-foreground">
                          {formatToolName(fn.name)}
                        </div>
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium bg-gray-100 dark:bg-card px-1.5 py-0.5 rounded">
                          {fn.mcpToolName ? t("mcp") : fn.method}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono mb-1">
                        {fn.name}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-muted-foreground line-clamp-2">
                        {fn.description}
                      </p>
                    </div>
                    <div className="flex items-center pt-1">
                      <Switch
                        checked={isEnabled}
                        onChange={() =>
                          togglePluginFunction(plugin.id, fn.name)
                        }
                        size="sm"
                        ariaLabel={
                          isEnabled
                            ? t("disableToolAria", {
                                tool: formatToolName(fn.name),
                                title: plugin.title,
                              })
                            : t("enableToolAria", {
                                tool: formatToolName(fn.name),
                                title: plugin.title,
                              })
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === "auth" && (
            <div
              id={authPanelId}
              role="tabpanel"
              aria-labelledby={authTabId}
              className="space-y-4"
            >
              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-xl p-4 flex gap-3">
                <ShieldAlert
                  size={20}
                  className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="text-xs text-blue-800 dark:text-blue-200">
                  <p className="font-semibold mb-1">{t("localStorageOnly")}</p>
                  <p className="opacity-80">{t("authStorageDesc")}</p>
                </div>
              </div>

              {isResearchSourceProvider(plugin.id) && (
                <p className="text-sm text-gray-600 dark:text-foreground/75">
                  {tSource("fixedEndpoints")}
                </p>
              )}
              {plugin.id === "epo-ops" ? (
                <ResearchSourceCredentials
                  hasSecret={hasPluginAuthValue(config.auth)}
                  onSave={handleSaveAuthSecret}
                  onClear={handleClearAuthSecret}
                />
              ) : plugin.auth?.type === "none" ? (
                <div className="text-sm text-gray-500 text-center py-4">
                  {t("noAuthRequired")}
                </div>
              ) : (
                <div className="space-y-2">
                  <label
                    htmlFor={authInputId}
                    className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-foreground/85"
                  >
                    <KeyRound size={16} aria-hidden="true" />{" "}
                    {plugin.id === "sec-edgar"
                      ? tSource("secContact")
                      : t("apiKeyLabel")}
                  </label>
                  <div className="relative">
                    <SecretInput
                      id={authInputId}
                      name={`${plugin.id}-auth-token`}
                      maxLength={PLUGIN_CONFIG_LIMITS.maxAuthValueChars}
                      placeholder={
                        plugin.id === "sec-edgar"
                          ? tSource("secContactPlaceholder")
                          : t("authPlaceholder")
                      }
                      hasSecret={hasPluginAuthValue(config.auth)}
                      onSave={handleSaveAuthSecret}
                      onClear={handleClearAuthSecret}
                      inputClassName="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm transition-[border-color,box-shadow] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-muted"
                    />
                  </div>
                  <p
                    id={authDescriptionId}
                    className="mt-1 text-xs text-gray-500"
                  >
                    {safeDocsUrl
                      ? t.rich("authDocsHint", {
                          link: (chunks) => (
                            <a
                              href={safeDocsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
                            >
                              {chunks}
                            </a>
                          ),
                        })
                      : t("authNoDocsHint")}
                  </p>
                </div>
              )}

              {supportsEndpointConfig && (
                <div className="space-y-2">
                  <label
                    htmlFor={`${modalId}-endpoint-input`}
                    className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-foreground/85"
                  >
                    <ExternalLink size={16} aria-hidden="true" />{" "}
                    {t("endpointLabel")}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id={`${modalId}-endpoint-input`}
                      type="url"
                      value={endpointValue}
                      maxLength={PLUGIN_CONFIG_LIMITS.maxBaseUrlChars}
                      placeholder={getEndpointPlaceholder(
                        plugin.id,
                        t("endpointPlaceholder"),
                      )}
                      onChange={(event) => setEndpointValue(event.target.value)}
                      onBlur={handleSaveEndpoint}
                      className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm transition-[border-color,box-shadow] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-muted"
                    />
                    <Button
                      variant="bare"
                      type="button"
                      onClick={handleClearEndpoint}
                      disabled={!endpointValue && !config.baseUrl}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:text-muted-foreground dark:hover:bg-muted"
                    >
                      {t("clearEndpoint")}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">{t("endpointHint")}</p>
                </div>
              )}

              {supportsModelConfig && (
                <div className="space-y-2">
                  <label
                    htmlFor={`${modalId}-model-input`}
                    className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-foreground/85"
                  >
                    <Settings size={16} aria-hidden="true" /> {t("modelLabel")}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id={`${modalId}-model-input`}
                      type="text"
                      value={modelValue}
                      maxLength={PLUGIN_CONFIG_LIMITS.maxModelNameChars}
                      placeholder={getModelPlaceholder(
                        plugin.id,
                        t("modelPlaceholder"),
                      )}
                      onChange={(event) => setModelValue(event.target.value)}
                      onBlur={handleSaveModel}
                      className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 font-mono text-sm transition-[border-color,box-shadow] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-muted"
                    />
                    <Button
                      variant="bare"
                      type="button"
                      onClick={handleClearModel}
                      disabled={!modelValue && !config.model}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:text-muted-foreground dark:hover:bg-muted"
                    >
                      {t("clearModel")}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">{t("modelHint")}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/50 p-4 dark:border-border dark:bg-card/50">
          <Button
            variant="bare"
            type="button"
            onClick={handleUninstall}
            disabled={!!plugin.builtIn}
            aria-label={
              plugin.builtIn
                ? t("builtInAria", { title: plugin.title })
                : isUninstallConfirming
                  ? t("confirmUninstallAria", { title: plugin.title })
                  : t("uninstallAria", { title: plugin.title })
            }
            className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 ${
              plugin.builtIn
                ? "text-gray-400 cursor-not-allowed"
                : isUninstallConfirming
                  ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200"
                  : "text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            }`}
          >
            {isUninstallConfirming ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Trash2 size={16} aria-hidden="true" />
            )}
            {plugin.builtIn
              ? t("builtIn")
              : isUninstallConfirming
                ? t("confirmUninstall")
                : t("uninstall")}
          </Button>

          <Button
            variant="bare"
            type="button"
            aria-label={t("saveSettingsAria", { title: plugin.title })}
            onClick={handleSave}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60"
          >
            <Save size={16} aria-hidden="true" /> {t("save")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const PluginMarket: React.FC<PluginMarketProps> = ({ onClose }) => {
  const t = useTranslations("Plugin");
  const tConfig = useTranslations("Config");
  const tSource = useTranslations("ResearchSources");
  const locale = useLocale();
  const {
    installedPlugins,
    activePlugins,
    addInstalledPlugin,
    updatePluginConfig,
    togglePluginActive,
    pluginConfigs,
    serverConfig,
    _hasHydrated,
  } = useSettingsStore();

  // Built-in plugins carry English product copy in the store; localize their
  // title/description for display (matched by id, so search/aria/details follow).
  const localizedInstalledPlugins = useMemo(
    () =>
      installedPlugins.map((plugin) =>
        isResearchSourceProvider(plugin.id)
          ? {
              ...plugin,
              title: tSource(`${plugin.id}Title`),
              description: tSource(`${plugin.id}Description`),
            }
          : localizePluginMeta(plugin, tConfig),
      ),
    [installedPlugins, tConfig, tSource],
  );
  const [availablePlugins, setAvailablePlugins] = useState<Plugin[]>([]);
  const [activeSource, setActiveSource] = useState<MarketSource>("plugins");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [installingIds, setInstallingIds] = useState<string[]>([]);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketLoadResult, setMarketLoadResult] = useState<
    MarketLoadResult<unknown> | undefined
  >();
  const [selectedPluginForDetails, setSelectedPluginForDetails] =
    useState<Plugin | null>(null);
  const [showCustomPluginModal, setShowCustomPluginModal] = useState(false);
  const [showCustomMcpServerModal, setShowCustomMcpServerModal] =
    useState(false);
  const [mcpPluginAwaitingAuth, setMcpPluginAwaitingAuth] =
    useState<Plugin | null>(null);
  const [mcpPageCursors, setMcpPageCursors] = useState<string[]>([""]);
  const [mcpNextCursor, setMcpNextCursor] = useState("");
  const isMountedRef = useRef(true);
  const pluginListRequestRef = useRef(0);
  const installingIdsRef = useRef<Set<string>>(new Set());
  const searchInputId = useId();
  const sourceTabs: Array<{ value: MarketSource; label: string }> = [
    { value: "plugins", label: t("plugins") },
    { value: "mcp", label: t("mcp") },
  ];

  // Pagination & Categorization State
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    const installingIds = installingIdsRef.current;

    return () => {
      isMountedRef.current = false;
      pluginListRequestRef.current += 1;
      installingIds.clear();
    };
  }, []);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (!_hasHydrated) return;
    if (activeSource !== "plugins") return;

    const cachedPlugins = getCachedPlugins();
    if (cachedPlugins.length > 0) {
      setAvailablePlugins(cachedPlugins);
      setMarketLoadResult(undefined);
      setIsLoading(false);
      return;
    }
    if (!isOnline || !isBrowserOnline()) {
      setAvailablePlugins([]);
      setIsLoading(false);
      return;
    }

    const load = async () => {
      const requestId = pluginListRequestRef.current + 1;
      pluginListRequestRef.current = requestId;
      setAvailablePlugins([]);
      setIsLoading(true);
      setMarketError(null);
      setMarketLoadResult(undefined);
      try {
        const result = await fetchApiGuruListResult();
        if (
          isMountedRef.current &&
          pluginListRequestRef.current === requestId
        ) {
          setAvailablePlugins(result.data);
          setMarketLoadResult(result);
        }
      } catch {
        if (
          isMountedRef.current &&
          pluginListRequestRef.current === requestId
        ) {
          setMarketError(t("loadFailed"));
        }
      } finally {
        if (
          isMountedRef.current &&
          pluginListRequestRef.current === requestId
        ) {
          setIsLoading(false);
        }
      }
    };
    load();
  }, [_hasHydrated, activeSource, isOnline, t]);

  useEffect(() => {
    if (!_hasHydrated) return;
    if (activeSource !== "mcp") return;
    if (!isOnline || !isBrowserOnline()) {
      setAvailablePlugins(getCachedMcpServers());
      setIsLoading(false);
      return;
    }

    const load = async () => {
      const requestId = pluginListRequestRef.current + 1;
      pluginListRequestRef.current = requestId;
      setAvailablePlugins([]);
      setIsLoading(true);
      setMarketError(null);
      setMarketLoadResult(undefined);
      try {
        const result = await fetchMcpServerPageResult({
          cursor: mcpPageCursors[currentPage - 1] || "",
          search: searchTerm,
          limit: ITEMS_PER_PAGE,
        });
        if (
          isMountedRef.current &&
          pluginListRequestRef.current === requestId
        ) {
          setAvailablePlugins(result.data.plugins);
          setMcpNextCursor(result.data.nextCursor || "");
          setMarketLoadResult(result);
        }
      } catch {
        if (
          isMountedRef.current &&
          pluginListRequestRef.current === requestId
        ) {
          setMarketError(t("loadFailed"));
        }
      } finally {
        if (
          isMountedRef.current &&
          pluginListRequestRef.current === requestId
        ) {
          setIsLoading(false);
        }
      }
    };

    load();
  }, [
    _hasHydrated,
    activeSource,
    currentPage,
    isOnline,
    mcpPageCursors,
    searchTerm,
    t,
  ]);

  const handleRefresh = async () => {
    if (!isOnline || !isBrowserOnline()) {
      setMarketError(t("offlineOperationsUnavailable"));
      return;
    }
    const requestId = pluginListRequestRef.current + 1;
    pluginListRequestRef.current = requestId;
    setIsRefreshing(true);
    setMarketError(null);
    try {
      let list: Plugin[];
      let nextCursor = "";
      let result: MarketLoadResult<unknown>;
      if (activeSource === "mcp") {
        const pageResult = await fetchMcpServerPageResult({
          forceRefresh: true,
          cursor: mcpPageCursors[currentPage - 1] || "",
          search: searchTerm,
          limit: ITEMS_PER_PAGE,
        });
        list = pageResult.data.plugins;
        nextCursor = pageResult.data.nextCursor || "";
        result = pageResult;
      } else {
        const pluginResult = await fetchApiGuruListResult(true);
        list = pluginResult.data;
        result = pluginResult;
      }

      if (isMountedRef.current && pluginListRequestRef.current === requestId) {
        if (result.status !== "error") {
          setAvailablePlugins(list);
        }
        setMarketLoadResult(result);
        if (activeSource === "mcp") {
          setMcpNextCursor(nextCursor);
        }
      }
    } catch {
      if (isMountedRef.current && pluginListRequestRef.current === requestId) {
        setMarketError(t("refreshFailed"));
      }
    } finally {
      if (isMountedRef.current && pluginListRequestRef.current === requestId) {
        setIsRefreshing(false);
      }
    }
  };

  // Reset to page 1 when search or category changes
  useEffect(() => {
    setCurrentPage(1);
    if (activeSource === "mcp") {
      setMcpPageCursors([""]);
      setMcpNextCursor("");
    }
  }, [searchTerm, selectedCategories, activeSource]);

  const installMarketplacePlugin = async (
    plugin: Plugin,
    authValue?: string,
  ): Promise<string | null> => {
    if (!isOnline || !isBrowserOnline()) {
      const message = t("offlineOperationsUnavailable");
      setMarketError(message);
      return message;
    }
    if (installingIdsRef.current.has(plugin.id)) return null;

    installingIdsRef.current.add(plugin.id);
    setInstallingIds(Array.from(installingIdsRef.current));
    setMarketError(null);
    try {
      const fullPlugin = await installPlugin(plugin, authValue);
      const normalizedAuthValue = authValue?.trim();
      const localValueSecret = normalizedAuthValue
        ? await encryptLocalSecret(
            normalizedAuthValue,
            LOCAL_SECRET_CONTEXTS.pluginAuth(fullPlugin.id),
          )
        : undefined;

      if (isMountedRef.current) {
        addInstalledPlugin(fullPlugin);
        if (localValueSecret) {
          updatePluginConfig(fullPlugin.id, {
            auth: {
              type:
                fullPlugin.auth?.type === "apiKey"
                  ? "apiKey"
                  : fullPlugin.auth?.type === "oauth2"
                    ? "oauth2"
                    : "bearer",
              value: "",
              localValueSecret,
              key:
                fullPlugin.auth?.name ||
                (fullPlugin.auth?.type === "apiKey"
                  ? "X-API-Key"
                  : "Authorization"),
              addTo: fullPlugin.auth?.in || "header",
            },
          });
        }
      }
      return null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("installFailed");
      if (isMountedRef.current) {
        setMarketError(message);
      }
      return message;
    } finally {
      if (isMountedRef.current) {
        installingIdsRef.current.delete(plugin.id);
        setInstallingIds(Array.from(installingIdsRef.current));
      }
    }
  };

  const handleInstall = (plugin: Plugin) => {
    if (plugin.source === "mcp" && isPluginAuthRequired(plugin)) {
      setMcpPluginAwaitingAuth(plugin);
      return;
    }

    void installMarketplacePlugin(plugin);
  };

  const handleCustomMcpInstalled = async (
    plugin: Plugin,
    bearerToken?: string,
  ) => {
    const token = bearerToken?.trim();
    const localValueSecret = token
      ? await encryptLocalSecret(
          token,
          LOCAL_SECRET_CONTEXTS.pluginAuth(plugin.id),
        )
      : undefined;

    addInstalledPlugin(plugin);
    if (localValueSecret) {
      updatePluginConfig(plugin.id, {
        auth: {
          type: "bearer",
          value: "",
          localValueSecret,
          key: "Authorization",
          addTo: "header",
        },
      });
    }
  };

  // Derive Categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    availablePlugins.forEach((p) => {
      if (p.categories) {
        p.categories.forEach((c) => cats.add(c));
      } else if (p.category) {
        cats.add(p.category);
      }
    });
    return Array.from(cats).sort();
  }, [availablePlugins]);

  const activeInstalledPlugins = useMemo(
    () =>
      localizedInstalledPlugins.filter((plugin) =>
        activeSource === "mcp"
          ? plugin.source === "mcp"
          : plugin.source !== "mcp",
      ),
    [activeSource, localizedInstalledPlugins],
  );

  // Filtered Installed Plugins (Always show if matching search)
  const filteredInstalledPlugins = useMemo(() => {
    return activeInstalledPlugins.filter(
      (p) =>
        p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.description.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [activeInstalledPlugins, searchTerm]);
  const installedPluginIdSet = useMemo(
    () => new Set(installedPlugins.map((plugin) => plugin.id)),
    [installedPlugins],
  );

  // Filtering & Sorting Logic for Available
  const filteredPlugins = useMemo(() => {
    const filtered = availablePlugins.filter((p) => {
      const matchesSearch =
        activeSource === "mcp"
          ? true
          : p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.description.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesCategory =
        selectedCategories.length === 0
          ? true
          : selectedCategories.some(
              (cat) => p.categories?.includes(cat) || p.category === cat,
            );

      return matchesSearch && matchesCategory;
    });

    if (activeSource === "mcp") {
      return filtered;
    }

    // Sort by added date (newest first)
    return filtered.sort((a, b) => {
      const timeA = a.added ? new Date(a.added).getTime() : 0;
      const timeB = b.added ? new Date(b.added).getTime() : 0;
      return timeB - timeA;
    });
  }, [activeSource, availablePlugins, searchTerm, selectedCategories]);

  // Pagination Logic
  const filteredAvailablePlugins = useMemo(
    () =>
      filteredPlugins.filter((plugin) => !installedPluginIdSet.has(plugin.id)),
    [filteredPlugins, installedPluginIdSet],
  );
  const totalPages =
    activeSource === "mcp"
      ? Math.max(1, currentPage + (mcpNextCursor ? 1 : 0))
      : Math.max(
          1,
          Math.ceil(filteredAvailablePlugins.length / ITEMS_PER_PAGE),
        );
  useEffect(() => {
    if (activeSource === "mcp") return;
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages));
  }, [activeSource, totalPages]);
  const paginatedPlugins =
    activeSource === "mcp"
      ? filteredAvailablePlugins
      : filteredAvailablePlugins.slice(
          (currentPage - 1) * ITEMS_PER_PAGE,
          currentPage * ITEMS_PER_PAGE,
        );

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  const handleNextPage = () => {
    if (activeSource === "mcp") {
      if (!mcpNextCursor) return;
      setMcpPageCursors((prev) => {
        const next = prev.slice(0, currentPage);
        next[currentPage] = mcpNextCursor;
        return next;
      });
      setCurrentPage((page) => page + 1);
      return;
    }

    setCurrentPage((page) => Math.min(totalPages, page + 1));
  };

  const handlePreviousPage = () => {
    setCurrentPage((page) => Math.max(1, page - 1));
  };

  const showPagination =
    activeSource === "mcp"
      ? currentPage > 1 || !!mcpNextCursor
      : totalPages > 1;
  const isNextPageDisabled =
    activeSource === "mcp" ? !mcpNextCursor : currentPage === totalPages;
  const marketNoticeMessage = (() => {
    if (marketLoadResult?.status === "stale") {
      const time = marketLoadResult.fetchedAt
        ? new Date(marketLoadResult.fetchedAt).toLocaleString(locale)
        : t("unknownCacheTime");
      return t("staleData", { time });
    }
    if (marketLoadResult?.status === "fallback") {
      return t("mcpDirectFallback");
    }
    if (marketLoadResult?.status === "error") {
      return t("loadFailed");
    }
    return "";
  })();

  return (
    <div className="flex flex-col h-full w-full relative overflow-hidden animate-in fade-in duration-300">
      {/* Detail Modal */}
      {selectedPluginForDetails && (
        <PluginDetailsModal
          key={selectedPluginForDetails.id}
          plugin={selectedPluginForDetails}
          onClose={() => setSelectedPluginForDetails(null)}
        />
      )}

      {/* Custom Plugin Modal */}
      {showCustomPluginModal && (
        <CustomPluginModal
          onClose={() => setShowCustomPluginModal(false)}
          onInstall={(p) => addInstalledPlugin(p)}
        />
      )}

      {showCustomMcpServerModal && (
        <CustomMcpServerModal
          onClose={() => setShowCustomMcpServerModal(false)}
          onInstall={handleCustomMcpInstalled}
          bridgeDiscoveryEnabled={serverConfig?.deployment?.mode === "local"}
          isOnline={isOnline}
        />
      )}

      {mcpPluginAwaitingAuth && (
        <McpInstallAuthModal
          plugin={mcpPluginAwaitingAuth}
          onClose={() => setMcpPluginAwaitingAuth(null)}
          onInstall={(authValue) =>
            installMarketplacePlugin(mcpPluginAwaitingAuth, authValue)
          }
        />
      )}

      {/* Header */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-gray-200/50 bg-white/40 px-6 py-4 backdrop-blur-md dark:border-border dark:bg-card/40">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-tr from-blue-500 to-purple-500 text-white shadow-lg shadow-blue-500/20"
            aria-hidden="true"
          >
            <Cable size={20} />
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
            onClick={handleRefresh}
            disabled={!isOnline || isRefreshing}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:text-muted-foreground dark:hover:bg-accent/50"
          >
            <RefreshCw
              size={18}
              className={isRefreshing ? "animate-spin" : ""}
              aria-hidden="true"
            />
          </Button>
          <Button
            variant="bare"
            type="button"
            aria-label={t("closeMarket")}
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:text-muted-foreground dark:hover:bg-accent/50"
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {!isOnline && (
        <div
          role="status"
          className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>{t("offlineOperationsUnavailable")}</span>
        </div>
      )}

      {marketError ? (
        <div
          role="alert"
          aria-live="polite"
          className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>{marketError}</span>
        </div>
      ) : null}

      {marketNoticeMessage ? (
        <div className="mx-6 mt-4">
          <MarketLoadNotice
            status={marketLoadResult?.status}
            message={marketNoticeMessage}
            retryLabel={t("retry")}
            onRetry={() => void handleRefresh()}
            isRetrying={isRefreshing}
          />
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-7xl shrink-0 justify-center px-6 pt-5">
        <div
          className="grid w-full max-w-[360px] grid-cols-2 rounded-2xl border border-gray-200/80 bg-white/70 p-1.5 backdrop-blur-xl dark:border-border dark:bg-muted/50"
          role="tablist"
          aria-label={t("sourceTabsAria")}
        >
          {sourceTabs.map((tab) => (
            <Button
              variant="bare"
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeSource === tab.value}
              onClick={() => {
                setActiveSource(tab.value);
                setSelectedCategories([]);
              }}
              className={`relative rounded-xl px-5 py-2.5 text-sm font-semibold transition-[background-color,color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 active:scale-[0.98] ${
                activeSource === tab.value
                  ? "bg-blue-600 text-white ring-1 ring-inset ring-white/35 dark:bg-blue-500"
                  : "text-gray-500 hover:bg-gray-100/80 hover:text-gray-900 dark:text-muted-foreground dark:hover:bg-accent/80 dark:hover:text-foreground"
              }`}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Search Bar & Filter */}
      <div className="mx-auto flex w-full max-w-7xl shrink-0 px-6 pb-6 pt-4">
        <div className="group relative min-w-0 flex-1">
          <div className="absolute inset-0 bg-blue-500/20 dark:bg-blue-500/10 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative flex items-center rounded-2xl border border-gray-200 bg-white/60 px-4 py-3 shadow-sm backdrop-blur-xl transition-[border-color,box-shadow] focus-within:border-blue-500/50 focus-within:ring-2 focus-within:ring-blue-500/30 dark:border-border dark:bg-muted/60">
            <label htmlFor={searchInputId} className="sr-only">
              {t("searchLabel")}
            </label>
            <Search
              size={20}
              className="mr-3 text-gray-400"
              aria-hidden="true"
            />
            <input
              id={searchInputId}
              type="text"
              name="plugin-search"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("searchPlaceholder")}
              className="min-w-0 flex-1 border-none bg-transparent text-base text-gray-800 outline-none placeholder-gray-400 dark:text-foreground"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Content Grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-10 custom-scrollbar">
        <div className="max-w-7xl mx-auto flex flex-col min-h-full">
          {/* Installed Section */}
          <div className="mb-8 shrink-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
              <h2 className="text-sm font-bold text-gray-500 dark:text-muted-foreground uppercase tracking-wider">
                {activeSource === "mcp"
                  ? t("installedMcpServers")
                  : t("installedPlugins")}
              </h2>
              <Button
                variant="bare"
                type="button"
                aria-label={
                  activeSource === "mcp"
                    ? t("installCustomMcpAria")
                    : t("installCustomAria")
                }
                onClick={() =>
                  activeSource === "mcp"
                    ? setShowCustomMcpServerModal(true)
                    : setShowCustomPluginModal(true)
                }
                disabled={!isOnline}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30"
              >
                <Plus size={14} aria-hidden="true" />{" "}
                {activeSource === "mcp" ? t("customMcp") : t("custom")}
              </Button>
            </div>
            {filteredInstalledPlugins.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredInstalledPlugins.map((plugin) => {
                  const needsAuth = isPluginAuthRequired(plugin);
                  const hasAuth = hasPluginAuthValue(
                    pluginConfigs[plugin.id]?.auth,
                  );
                  // Unsplash is exception
                  const isUnsplash = plugin.id === "unsplash";
                  const showWarning = needsAuth && !hasAuth && !isUnsplash;

                  return (
                    <div
                      key={plugin.id}
                      className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white/40 p-4 backdrop-blur-md transition-[border-color,box-shadow] duration-300 hover:border-blue-300 dark:border-border dark:bg-muted/40 dark:hover:border-blue-700"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
                          <div className="w-12 h-12 rounded-xl bg-white dark:bg-accent border border-gray-100 dark:border-input flex items-center justify-center p-2 shrink-0">
                            <SafeImage
                              src={plugin.logoUrl}
                              alt=""
                              className="w-full h-full object-contain"
                              fallback={
                                <Cable
                                  size={24}
                                  className="text-gray-400"
                                  aria-hidden="true"
                                />
                              }
                            />
                          </div>
                          <div className="flex min-w-0 flex-col items-start gap-1">
                            {plugin.builtIn && (
                              <span className="flex max-w-full items-center gap-0.5 rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                                <Zap size={8} aria-hidden="true" />{" "}
                                {t("builtIn")}
                              </span>
                            )}
                            {plugin.source === "mcp" && (
                              <span className="max-w-full truncate rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                {t("mcp")}
                              </span>
                            )}
                            {plugin.source === "mcp" && plugin.mcp && (
                              <span className="max-w-full truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[9px] text-gray-500 dark:bg-card dark:text-muted-foreground">
                                {plugin.mcp.transport}
                              </span>
                            )}
                            {plugin.category && (
                              <span className="max-w-25 truncate rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                                {formatCategoryName(plugin.category)}
                              </span>
                            )}
                          </div>
                        </div>
                        <Switch
                          checked={activePlugins.includes(plugin.id)}
                          onChange={() => togglePluginActive(plugin.id)}
                          disabled={showWarning} // Disable switch if auth missing
                          ariaLabel={
                            activePlugins.includes(plugin.id)
                              ? t("disablePluginAria", { title: plugin.title })
                              : t("enablePluginAria", { title: plugin.title })
                          }
                        />
                      </div>
                      <h3 className="font-semibold text-gray-800 dark:text-foreground mb-1 truncate pr-2">
                        {plugin.title}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-muted-foreground line-clamp-2 leading-relaxed mb-3 flex-1">
                        {plugin.description}
                      </p>

                      {showWarning && (
                        <div className="mb-3 flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
                          <AlertTriangle size={12} aria-hidden="true" />
                          <span className="truncate">{t("authMissing")}</span>
                        </div>
                      )}

                      <div className="mt-auto flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2 rounded bg-gray-100 px-2 py-1 font-mono text-[10px] text-gray-400 dark:bg-muted/50">
                          <span>
                            {t(
                              plugin.source === "mcp"
                                ? "installedMcpTools"
                                : "installedPluginTools",
                              {
                                count: plugin.functions?.length || 0,
                              },
                            )}
                          </span>
                        </div>
                        <Button
                          variant="bare"
                          type="button"
                          aria-label={t("configureAria", {
                            title: plugin.title,
                          })}
                          onClick={() => setSelectedPluginForDetails(plugin)}
                          className={`rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:hover:bg-accent dark:hover:text-foreground/85 ${showWarning ? "bg-amber-50 text-amber-500 dark:bg-amber-900/10 dark:text-amber-400" : ""}`}
                        >
                          <Settings size={16} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white/30 px-4 py-6 text-center text-sm text-gray-400 dark:border-border dark:bg-muted/20">
                {t("noPluginsFound")}
              </div>
            )}
          </div>

          {/* Available Section */}
          <div className="flex-1 flex flex-col">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <h2 className="min-w-0 truncate text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-muted-foreground">
                  {searchTerm ? t("searchResults") : t("explore")}
                </h2>
              </div>

              {/* Category Filter */}
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
                      className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${
                        selectedCategories.length > 0
                          ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
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
                    {categories.map((cat) => (
                      <DropdownMenuCheckboxItem
                        key={cat}
                        checked={selectedCategories.includes(cat)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() => toggleCategory(cat)}
                      >
                        <span className="truncate">
                          {formatCategoryName(cat)}
                        </span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {isLoading ? (
              <div
                role="status"
                aria-live="polite"
                className="flex h-64 flex-col items-center justify-center gap-4 text-gray-400"
              >
                <Loader2
                  size={32}
                  className="animate-spin text-blue-500"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium">
                  {t("loadingEcosystem")}
                </span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 flex-1 content-start">
                  {paginatedPlugins.map((plugin) => {
                    return (
                      <div
                        key={plugin.id}
                        className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white/40 p-4 backdrop-blur-md transition-[border-color,box-shadow] duration-300 hover:border-blue-300 dark:border-border dark:bg-muted/40 dark:hover:border-blue-700"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
                            <div className="w-10 h-10 rounded-xl bg-white dark:bg-accent border border-gray-100 dark:border-input flex items-center justify-center p-1.5 shrink-0">
                              <SafeImage
                                src={plugin.logoUrl}
                                alt=""
                                className="w-full h-full object-contain"
                                fallback={
                                  <Cable
                                    size={20}
                                    className="text-gray-400"
                                    aria-hidden="true"
                                  />
                                }
                              />
                            </div>
                            <div className="flex min-w-0 flex-wrap gap-1">
                              {plugin.source === "mcp" && (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-800 truncate max-w-25">
                                  {t("mcp")}
                                </span>
                              )}
                              {plugin.source === "mcp" && plugin.mcp && (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 dark:bg-card dark:text-muted-foreground border border-gray-100 dark:border-border truncate max-w-32">
                                  {plugin.mcp.transport}
                                </span>
                              )}
                              {plugin.category && (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300 border border-blue-100 dark:border-blue-800 truncate max-w-25">
                                  {formatCategoryName(plugin.category)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <h3 className="font-semibold text-gray-800 dark:text-foreground mb-1 truncate text-sm">
                          {plugin.title}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-muted-foreground line-clamp-2 leading-relaxed mb-4 flex-1">
                          {plugin.description}
                        </p>

                        <Button
                          variant="bare"
                          type="button"
                          aria-label={
                            installingIds.includes(plugin.id)
                              ? t("installingAria", { title: plugin.title })
                              : t("installPluginAria", { title: plugin.title })
                          }
                          aria-busy={
                            installingIds.includes(plugin.id) || undefined
                          }
                          onClick={() => handleInstall(plugin)}
                          disabled={
                            !isOnline || installingIds.includes(plugin.id)
                          }
                          className="group flex w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-gray-50 py-2 text-xs font-medium text-gray-600 transition-[background-color,border-color,color] hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-accent/50 dark:text-foreground/85 dark:hover:border-blue-800 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                        >
                          {installingIds.includes(plugin.id) ? (
                            <Loader2
                              size={14}
                              className="animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <>
                              <Download
                                size={14}
                                className="group-hover:-translate-y-0.5 transition-transform"
                                aria-hidden="true"
                              />
                              {t("install")}
                            </>
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>

                {paginatedPlugins.length === 0 &&
                  marketLoadResult &&
                  ["fresh", "cache", "fallback"].includes(
                    marketLoadResult.status,
                  ) && (
                    <div
                      data-testid="plugin-market-empty"
                      className="text-center py-12 text-gray-400"
                    >
                      <p>{t("noPluginsFound")}</p>
                    </div>
                  )}

                {/* Pagination Controls */}
                {showPagination && (
                  <div className="py-6 flex items-center justify-center gap-4 mt-auto">
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("prevPageAria")}
                      onClick={handlePreviousPage}
                      disabled={currentPage === 1}
                      className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-muted dark:text-foreground/85 dark:hover:bg-accent"
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </Button>
                    <span className="text-sm font-medium tabular-nums text-gray-600 dark:text-foreground/85">
                      {activeSource === "mcp"
                        ? t("pageCurrent", { currentPage })
                        : t("pageOf", { currentPage, totalPages })}
                    </span>
                    <Button
                      variant="bare"
                      type="button"
                      aria-label={t("nextPageAria")}
                      onClick={handleNextPage}
                      disabled={isNextPageDisabled}
                      className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-muted dark:text-foreground/85 dark:hover:bg-accent"
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PluginMarket;
