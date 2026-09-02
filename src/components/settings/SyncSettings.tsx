"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  Copy,
  HardDrive,
  KeyRound,
  Laptop,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  SyncProviderConfig,
  SyncProviderCredentials,
} from "@/lib/sync/types";
import { useSyncStore } from "@/store/core/syncStore";
import SyncRecoveryQr from "@/components/sync/SyncRecoveryQr";
import {
  inspectLocalStorageHealth,
  type LocalStorageHealthSnapshot,
} from "@/lib/data/storageHealth";
import { Button } from "@/components/ui/primitives";

type ProviderKind = "webdav" | "s3";

const inputClass =
  "min-h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const primaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
      {hint ? (
        <span className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

const SyncSettings: React.FC = () => {
  const t = useTranslations("Sync");
  const store = useSyncStore();
  const [providerKind, setProviderKind] = useState<ProviderKind>(
    store.provider?.kind || "webdav",
  );
  const [endpoint, setEndpoint] = useState("");
  const [rootPath, setRootPath] = useState("neo-chat-sync");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("neo-chat-sync");
  const [forcePathStyle, setForcePathStyle] = useState(true);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState("");
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [providerDraftDirty, setProviderDraftDirty] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [operationError, setOperationError] = useState<string>();
  const [storageHealth, setStorageHealth] =
    useState<LocalStorageHealthSnapshot>();
  const [storageHealthLoading, setStorageHealthLoading] = useState(false);
  const storageHealthRequestRef = useRef(0);

  const refreshStorageHealth = useCallback(async () => {
    const requestId = storageHealthRequestRef.current + 1;
    storageHealthRequestRef.current = requestId;
    setStorageHealthLoading(true);
    try {
      const snapshot = await inspectLocalStorageHealth();
      if (storageHealthRequestRef.current !== requestId) return;
      setStorageHealth(snapshot);
    } catch {
      if (storageHealthRequestRef.current !== requestId) return;
      setStorageHealth({ quota: null, opfs: null });
    } finally {
      if (storageHealthRequestRef.current === requestId) {
        setStorageHealthLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshStorageHealth();
    return () => {
      storageHealthRequestRef.current += 1;
    };
  }, [refreshStorageHealth]);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(navigator.onLine);
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (store.provider?.kind === "webdav") {
      setProviderKind("webdav");
      setEndpoint(store.provider.baseUrl);
      setRootPath(store.provider.rootPath);
    } else if (store.provider?.kind === "s3") {
      setProviderKind("s3");
      setEndpoint(store.provider.endpoint);
      setRegion(store.provider.region);
      setBucket(store.provider.bucket);
      setPrefix(store.provider.prefix);
      setForcePathStyle(store.provider.forcePathStyle);
    }
    setProviderDraftDirty(false);
  }, [store.provider]);

  const statusLabel = t(`status.${store.status}`);
  const canSync = Boolean(
    store.enabled &&
    store.provider &&
    store.rootKeySecret &&
    isOnline &&
    !store.activeController,
  );
  const formattedBytes = useMemo(() => {
    const bytes = store.lastSyncBytes || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }, [store.lastSyncBytes]);
  const formatStorageBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const run = async (operation: () => Promise<void>) => {
    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }
    setOperationError(undefined);
    setLocalBusy(true);
    try {
      await operation();
    } catch (error) {
      setOperationError(
        error instanceof Error && error.message
          ? error.message
          : t("operationFailed"),
      );
    } finally {
      setLocalBusy(false);
    }
  };

  const runConnectionTest = async () => {
    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }
    setOperationError(undefined);
    setLocalBusy(true);
    try {
      await store.testConnection();
    } catch {
      // The store owns this result so it can remain next to the provider
      // controls instead of being presented as a sync failure.
    } finally {
      setLocalBusy(false);
    }
  };

  const saveProvider = () =>
    run(async () => {
      let provider: SyncProviderConfig;
      let credentials: SyncProviderCredentials;
      if (providerKind === "webdav") {
        provider = {
          kind: "webdav",
          baseUrl: endpoint.trim(),
          rootPath: rootPath.trim().replace(/^\/+|\/+$/g, ""),
        };
        credentials = {
          kind: "webdav",
          username: username.trim(),
          password,
        };
      } else {
        provider = {
          kind: "s3",
          endpoint: endpoint.trim(),
          region: region.trim(),
          bucket: bucket.trim(),
          prefix: prefix.trim().replace(/^\/+|\/+$/g, ""),
          forcePathStyle,
        };
        credentials = {
          kind: "s3",
          accessKeyId: accessKeyId.trim(),
          secretAccessKey,
          sessionToken: sessionToken.trim() || undefined,
        };
      }
      await store.configureProvider(provider, credentials);
      setProviderDraftDirty(false);
      setPassword("");
      setSecretAccessKey("");
      setSessionToken("");
    });

  const generateVault = () =>
    run(async () => {
      setPendingRecoveryCode(await store.createRecoveryCode());
      setRecoverySaved(false);
      setCopied(false);
    });

  const activateGeneratedVault = () =>
    run(async () => {
      await store.createNewVault(pendingRecoveryCode);
      setPendingRecoveryCode("");
      setRecoverySaved(false);
    });

  const importVault = () =>
    run(async () => {
      await store.initializeVault(recoveryInput);
      setRecoveryInput("");
    });

  const copyRecoveryCode = async () => {
    setOperationError(undefined);
    try {
      await navigator.clipboard.writeText(pendingRecoveryCode);
      setCopied(true);
    } catch (error) {
      setOperationError(
        error instanceof Error && error.message
          ? error.message
          : t("operationFailed"),
      );
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl border border-brand/20 bg-brand/10 p-2.5 text-brand">
          <ShieldCheck size={20} aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t("title")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("description")}
          </p>
        </div>
      </header>

      {!isOnline ? (
        <div
          role="status"
          className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
        >
          <AlertTriangle
            size={17}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <span>{t("offlineBoundary")}</span>
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">
              {t("statusTitle")}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {store.lastSyncAt
                ? t("lastSync", {
                    time: new Date(store.lastSyncAt).toLocaleString(),
                    bytes: formattedBytes,
                  })
                : t("neverSynced")}
            </p>
          </div>
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              store.status === "error"
                ? "border-red-300 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200"
                : store.status === "conflict"
                  ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
                  : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
            }`}
          >
            {statusLabel}
          </span>
        </div>
        {store.error || operationError ? (
          <div
            role="alert"
            className="mt-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200"
          >
            <AlertTriangle
              size={17}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 break-words">
              {operationError || store.error}
            </span>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="bare"
            type="button"
            className={primaryButton}
            disabled={!canSync}
            onClick={() => void run(() => store.syncNow("manual"))}
          >
            {store.activeController ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={16} aria-hidden="true" />
            )}
            {t("syncNow")}
          </Button>
          {store.activeController ? (
            <Button
              variant="bare"
              type="button"
              className={secondaryButton}
              onClick={store.cancelSync}
            >
              {t("cancel")}
            </Button>
          ) : null}
          {store.requiresReload ? (
            <Button
              variant="bare"
              type="button"
              className={secondaryButton}
              onClick={() => window.location.reload()}
            >
              {t("reload")}
            </Button>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-foreground">
              {t("storageHealthTitle")}
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("storageHealthDescription")}
            </p>
          </div>
          <Button
            variant="bare"
            type="button"
            className={secondaryButton}
            disabled={storageHealthLoading}
            onClick={() => void refreshStorageHealth()}
          >
            <RefreshCw
              size={16}
              className={storageHealthLoading ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            {storageHealthLoading ? t("healthChecking") : t("refreshHealth")}
          </Button>
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <dt className="text-xs font-medium text-muted-foreground">
              {t("storageUsage")}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {storageHealth?.quota
                ? t("storageUsageValue", {
                    used: formatStorageBytes(storageHealth.quota.usage),
                    quota: formatStorageBytes(storageHealth.quota.quota),
                  })
                : t("healthUnavailable")}
            </dd>
          </div>
          {(
            [
              ["referencedFiles", storageHealth?.opfs?.referencedCount],
              ["storedFiles", storageHealth?.opfs?.storedCount],
              ["orphanFiles", storageHealth?.opfs?.orphanCount],
              ["missingFiles", storageHealth?.opfs?.missingCount],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-muted/40 p-3"
            >
              <dt className="text-xs font-medium text-muted-foreground">
                {t(label)}
              </dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">
                {value ?? t("healthUnavailable")}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">
              {t("backupFreshness")}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("backupFreshnessUnavailable")}
            </p>
            <a
              className={`${secondaryButton} mt-3`}
              href="?panel=settings&settingsTab=system"
            >
              {t("openBackupSettings")}
            </a>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">
              {t("deviceSecurity")}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("deviceSecurityPlanned")}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 md:p-5">
        <div className="flex items-center gap-2">
          <Cloud size={18} className="text-brand" aria-hidden="true" />
          <h3 className="font-semibold text-foreground">
            {t("providerTitle")}
          </h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("providerDescription")}
        </p>
        <div
          className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1"
          role="radiogroup"
          aria-label={t("providerType")}
        >
          {(["webdav", "s3"] as const).map((kind) => (
            <Button
              variant="bare"
              key={kind}
              type="button"
              role="radio"
              aria-checked={providerKind === kind}
              disabled={!isOnline || localBusy}
              className={`min-h-9 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                providerKind === kind
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                setProviderKind(kind);
                setProviderDraftDirty(true);
              }}
            >
              {kind === "webdav" ? "WebDAV" : "S3 / MinIO"}
            </Button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label={t("endpoint")}>
            <input
              className={inputClass}
              type="url"
              value={endpoint}
              onChange={(event) => {
                setEndpoint(event.target.value);
                setProviderDraftDirty(true);
              }}
              placeholder={
                providerKind === "webdav"
                  ? "https://dav.example.com/remote.php/dav/files/me"
                  : "https://s3.example.com"
              }
            />
          </Field>
          {providerKind === "webdav" ? (
            <>
              <Field label={t("rootPath")}>
                <input
                  className={inputClass}
                  value={rootPath}
                  onChange={(event) => {
                    setRootPath(event.target.value);
                    setProviderDraftDirty(true);
                  }}
                />
              </Field>
              <Field label={t("username")}>
                <input
                  className={inputClass}
                  autoComplete="username"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setProviderDraftDirty(true);
                  }}
                />
              </Field>
              <Field
                label={t("password")}
                hint={
                  store.credentialSecret
                    ? t("replaceCredentialHint")
                    : undefined
                }
              >
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setProviderDraftDirty(true);
                  }}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label={t("region")}>
                <input
                  className={inputClass}
                  value={region}
                  onChange={(event) => {
                    setRegion(event.target.value);
                    setProviderDraftDirty(true);
                  }}
                />
              </Field>
              <Field label={t("bucket")}>
                <input
                  className={inputClass}
                  value={bucket}
                  onChange={(event) => {
                    setBucket(event.target.value);
                    setProviderDraftDirty(true);
                  }}
                />
              </Field>
              <Field label={t("prefix")}>
                <input
                  className={inputClass}
                  value={prefix}
                  onChange={(event) => {
                    setPrefix(event.target.value);
                    setProviderDraftDirty(true);
                  }}
                />
              </Field>
              <Field label={t("accessKeyId")}>
                <input
                  className={inputClass}
                  autoComplete="off"
                  value={accessKeyId}
                  onChange={(event) => {
                    setAccessKeyId(event.target.value);
                    setProviderDraftDirty(true);
                  }}
                />
              </Field>
              <Field
                label={t("secretAccessKey")}
                hint={
                  store.credentialSecret
                    ? t("replaceCredentialHint")
                    : undefined
                }
              >
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="off"
                  value={secretAccessKey}
                  onChange={(event) => {
                    setSecretAccessKey(event.target.value);
                    setProviderDraftDirty(true);
                  }}
                />
              </Field>
              <Field label={t("sessionTokenOptional")}>
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="off"
                  value={sessionToken}
                  onChange={(event) => {
                    setSessionToken(event.target.value);
                    setProviderDraftDirty(true);
                  }}
                />
              </Field>
              <label className="flex min-h-10 items-center gap-2 self-end text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={forcePathStyle}
                  onChange={(event) => {
                    setForcePathStyle(event.target.checked);
                    setProviderDraftDirty(true);
                  }}
                />
                {t("forcePathStyle")}
              </label>
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="bare"
            type="button"
            className={primaryButton}
            disabled={localBusy || !isOnline || !endpoint.trim()}
            onClick={() => void saveProvider()}
          >
            <HardDrive size={16} aria-hidden="true" />
            {t("saveProvider")}
          </Button>
          <Button
            variant="bare"
            type="button"
            className={secondaryButton}
            disabled={
              localBusy ||
              !isOnline ||
              providerDraftDirty ||
              !store.provider ||
              !store.credentialSecret
            }
            onClick={() => void runConnectionTest()}
          >
            {store.connectionTestStatus === "testing" ? (
              <Loader2
                size={16}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Check size={16} aria-hidden="true" />
            )}
            {t("testConnection")}
          </Button>
        </div>
        {!providerDraftDirty && store.connectionTestStatus === "testing" ? (
          <p
            className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2
              size={16}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {t("connectionTesting")}
          </p>
        ) : null}
        {!providerDraftDirty && store.connectionTestStatus === "success" ? (
          <p
            className="mt-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-200"
            role="status"
            aria-live="polite"
          >
            <Check size={16} aria-hidden="true" />
            {t("connectionTestSuccess")}
          </p>
        ) : null}
        {!providerDraftDirty && store.connectionTestStatus === "error" ? (
          <div
            className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200"
            role="alert"
          >
            <AlertTriangle
              size={17}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 break-words">
              {t("connectionTestError", {
                error: store.connectionTestError || t("operationFailed"),
              })}
            </span>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 md:p-5">
        <div className="flex items-center gap-2">
          <KeyRound size={18} className="text-brand" aria-hidden="true" />
          <h3 className="font-semibold text-foreground">{t("vaultTitle")}</h3>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {t("vaultDescription")}
        </p>
        {store.vaultId ? (
          <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm">
            <span className="text-muted-foreground">{t("vaultId")}: </span>
            <code className="break-all text-foreground">{store.vaultId}</code>
          </div>
        ) : null}
        {pendingRecoveryCode ? (
          <div className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-400/30 dark:bg-amber-400/10">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              {t("saveRecoveryWarning")}
            </p>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              <textarea
                className={`${inputClass} min-h-24 resize-y font-mono text-xs`}
                readOnly
                value={pendingRecoveryCode}
                aria-label={t("recoveryCode")}
              />
              <SyncRecoveryQr
                payload={pendingRecoveryCode}
                alt={t("recoveryQrAlt")}
                loadingLabel={t("recoveryQrLoading")}
                errorLabel={t("recoveryQrError")}
              />
            </div>
            <Button
              variant="bare"
              type="button"
              className={secondaryButton}
              onClick={() => void copyRecoveryCode()}
            >
              {copied ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              {copied ? t("copied") : t("copy")}
            </Button>
            <label className="flex items-start gap-2 text-sm text-amber-950 dark:text-amber-100">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={recoverySaved}
                onChange={(event) => setRecoverySaved(event.target.checked)}
              />
              {t("recoverySavedConfirmation")}
            </label>
            <Button
              variant="bare"
              type="button"
              className={primaryButton}
              disabled={!recoverySaved || localBusy || !isOnline}
              onClick={() => void activateGeneratedVault()}
            >
              <ShieldCheck size={16} aria-hidden="true" />
              {t("activateVault")}
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="bare"
              type="button"
              className={primaryButton}
              disabled={localBusy || !isOnline}
              onClick={() => void generateVault()}
            >
              <KeyRound size={16} aria-hidden="true" />
              {store.vaultId ? t("newVault") : t("createVault")}
            </Button>
            {store.vaultId ? (
              <p className="w-full text-xs leading-5 text-muted-foreground">
                {t("newVaultHint")}
              </p>
            ) : null}
          </div>
        )}
        <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {t("orImport")}
          <span className="h-px flex-1 bg-border" />
        </div>
        <Field label={t("recoveryCode")} hint={t("recoveryCodeHint")}>
          <textarea
            className={`${inputClass} min-h-24 resize-y font-mono text-xs`}
            value={recoveryInput}
            onChange={(event) => setRecoveryInput(event.target.value)}
          />
        </Field>
        <Button
          variant="bare"
          type="button"
          className={`${secondaryButton} mt-3`}
          disabled={localBusy || !isOnline || !recoveryInput.trim()}
          onClick={() => void importVault()}
        >
          {t("importVault")}
        </Button>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 md:p-5">
        <div className="flex items-center gap-2">
          <Laptop size={18} className="text-brand" aria-hidden="true" />
          <h3 className="font-semibold text-foreground">{t("devicesTitle")}</h3>
        </div>
        <Field label={t("deviceName")}>
          <input
            className={`${inputClass} mt-4`}
            defaultValue={store.deviceName}
            maxLength={120}
            disabled={!isOnline}
            onBlur={(event) => {
              if (isOnline) store.setDeviceName(event.target.value);
            }}
          />
        </Field>
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {store.devices.length ? (
            store.devices.map((device) => (
              <li
                key={device.id}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {device.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {device.id}
                  </p>
                </div>
                <time
                  className="shrink-0 text-xs text-muted-foreground"
                  dateTime={device.lastSeenAt}
                >
                  {new Date(device.lastSeenAt).toLocaleString()}
                </time>
              </li>
            ))
          ) : (
            <li className="p-3 text-sm text-muted-foreground">
              {t("noDevices")}
            </li>
          )}
        </ul>
      </section>

      {store.conflicts.length ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50/50 p-4 md:p-5 dark:border-amber-400/30 dark:bg-amber-400/10">
          <h3 className="font-semibold text-amber-950 dark:text-amber-100">
            {t("conflictsTitle")}
          </h3>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
            {t("conflictsDescription")}
          </p>
          <div className="mt-4 space-y-3">
            {store.conflicts.map((conflict) => (
              <div
                key={conflict.id}
                className="rounded-lg border border-amber-300 bg-background p-3 dark:border-amber-400/30"
              >
                <code className="break-all text-xs text-muted-foreground">
                  {conflict.documentId}:{conflict.path.join(".")}
                </code>
                <div className="mt-3 flex flex-wrap gap-2">
                  {conflict.values.map((value, index) => (
                    <Button
                      variant="bare"
                      key={`${conflict.id}-${index}`}
                      type="button"
                      className={secondaryButton}
                      disabled={localBusy || !isOnline}
                      onClick={() =>
                        void run(() => store.resolveConflict(conflict, value))
                      }
                    >
                      {t("chooseValue", {
                        value: JSON.stringify(value).slice(0, 80),
                      })}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {store.enabled ? (
        <section className="rounded-xl border border-border p-4">
          <Button
            variant="bare"
            type="button"
            className={secondaryButton}
            onClick={store.disableSync}
          >
            {t("disableSync")}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("disableHint")}
          </p>
        </section>
      ) : null}
    </div>
  );
};

export default SyncSettings;
