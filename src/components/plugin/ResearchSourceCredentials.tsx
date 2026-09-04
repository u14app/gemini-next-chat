"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

/** The pair is encrypted as one existing plugin secret; neither value is re-read. */
export function ResearchSourceCredentials({
  hasSecret,
  onSave,
  onClear,
}: {
  hasSecret: boolean;
  onSave: (value: string) => Promise<void>;
  onClear: () => void;
}) {
  const t = useTranslations("ResearchSources");
  const id = useId();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const inputClass =
    "w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-muted";
  const save = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    setError(false);
    try {
      await onSave(
        JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        }),
      );
      setClientId("");
      setClientSecret("");
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-foreground/75">
        {t("epoCredentialsHelp")}
      </p>
      <div className="space-y-2">
        <label htmlFor={`${id}-client`} className="block text-sm font-medium">
          {t("clientId")}
        </label>
        <input
          id={`${id}-client`}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          maxLength={300}
          autoComplete="off"
          spellCheck={false}
          disabled={saving}
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor={`${id}-secret`} className="block text-sm font-medium">
          {t("clientSecret")}
        </label>
        <input
          id={`${id}-secret`}
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          maxLength={300}
          autoComplete="new-password"
          disabled={saving}
          className={inputClass}
        />
      </div>
      {hasSecret && (
        <p role="status" className="text-sm text-blue-600 dark:text-blue-400">
          {t("credentialsSaved")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t("saveFailed")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !clientId.trim() || !clientSecret.trim()}
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {saving ? t("saving") : t("save")}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={saving || !hasSecret}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-border disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {t("clear")}
        </button>
      </div>
    </div>
  );
}
