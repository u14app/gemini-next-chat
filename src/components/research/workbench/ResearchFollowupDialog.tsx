"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";

import { Button, Dialog } from "@/components/ui/primitives";

import type { FollowupMode } from "./workbenchUtils";

export function ResearchFollowupDialog({
  mode,
  onClose,
  onSubmit,
}: {
  mode: FollowupMode | null;
  onClose: () => void;
  onSubmit: (value: string) => void | Promise<void>;
}) {
  const t = useTranslations("Research");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const fieldId = `research-followup-${mode ?? "closed"}`;

  const close = () => {
    if (submitting) return;
    setValue("");
    setError(false);
    onClose();
  };

  return (
    <Dialog
      open={mode !== null}
      onClose={close}
      title={mode ? t(`followup.${mode}.title`) : ""}
      placement="responsive-sheet"
    >
      {mode ? (
        <form
          className="space-y-4 p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const input = value.trim();
            if (!input || submitting) return;
            setSubmitting(true);
            setError(false);
            try {
              await onSubmit(input);
              setValue("");
              onClose();
            } catch {
              setError(true);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div>
            <label
              htmlFor={fieldId}
              className="text-sm font-medium text-foreground"
            >
              {t(`followup.${mode}.label`)}
            </label>
            <p
              id={`${fieldId}-help`}
              className="mt-1 text-xs leading-5 text-muted-foreground"
            >
              {t(`followup.${mode}.help`)}
            </p>
            <textarea
              id={fieldId}
              aria-describedby={`${fieldId}-help`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={5}
              placeholder={t(`followup.${mode}.placeholder`)}
              className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            {error ? (
              <p
                className="mt-2 text-xs text-red-700 dark:text-red-300"
                role="alert"
              >
                {t("followup.error")}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 [&_button]:h-9 [&_button]:min-h-0 sm:[&_button]:h-8">
            <Button onClick={close} disabled={submitting}>
              {t("actions.dismiss")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!value.trim() || submitting}
              className="bg-research-solid text-research-accent-foreground hover:bg-research-accent-hover"
            >
              {submitting
                ? t("followup.submitting")
                : t(`followup.${mode}.submit`)}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
