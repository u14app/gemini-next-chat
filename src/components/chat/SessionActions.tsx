"use client";

import React, { createContext, useContext, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  Check,
  Copy,
  FileOutput,
  Folder,
  FolderInput,
  Ellipsis,
  PenLine,
  Pin,
  PinOff,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Session } from "@/types";
import { readSessionForPresentation } from "./sessionPresentation";
import { useChatStore } from "@/store/core/chatStore";
import { useSettingsStore } from "@/store/core/settingsStore";
import { getSessionDisplayTitle } from "@/lib/chat/sessionTitle";
import { isTemporarySession } from "@/lib/chat/sessionRetention";
import { sanitizeDownloadFilename } from "@/lib/utils/filename";
import { CHAT_ENTITY_LIMITS } from "@/config/limits";
import { Button, Dialog, IconButton } from "@/components/ui/primitives";
import Tooltip from "@/components/ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ShareDialog = dynamic(() => import("@/components/sharing/ShareDialog"), {
  ssr: false,
});

interface SessionActions {
  onDelete: (id: string) => void | Promise<void>;
  onRename: (id: string, title: string) => void;
  onTogglePin?: (id: string) => void;
  onDuplicate?: (id: string) => void | Promise<void>;
  onSmartRename?: (id: string) => void | Promise<void>;
  duplicateDisabled?: boolean;
}

interface ActionsContextValue extends SessionActions {
  rename: (session: Session) => void;
  exportSession: (session: Session) => void;
  share: (id: string) => void;
  run: (action: () => void | Promise<void>) => void;
}

const ActionsContext = createContext<ActionsContextValue | null>(null);

export function SessionActionsProvider({
  children,
  ...actions
}: SessionActions & { children: React.ReactNode }) {
  const t = useTranslations("Sidebar");
  const common = useTranslations("Common");
  const [renaming, setRenaming] = useState<Session | null>(null);
  const [title, setTitle] = useState("");
  const [shareId, setShareId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => void | Promise<void>) => {
    void Promise.resolve()
      .then(action)
      .catch(() => setError(t("actionError")));
  };
  const exportSession = (session: Session) => {
    run(async () => {
      const snapshot = await readSessionForPresentation(session);
      const temporary = isTemporarySession(session);
      const body = temporary
        ? snapshot.messages
            .map(
              (message) =>
                `## ${message.role === "user" ? t("you") : t("assistant")}\n\n${message.content}`,
            )
            .join("\n\n")
        : JSON.stringify(snapshot, null, 2);
      const url = URL.createObjectURL(
        new Blob([body], {
          type: temporary
            ? "text/markdown;charset=utf-8"
            : "application/json;charset=utf-8",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = sanitizeDownloadFilename(
        `chat_export_${getSessionDisplayTitle(session.title, t("newChat"))}.${temporary ? "md" : "json"}`,
      );
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
    });
  };
  const closeRename = () => setRenaming(null);
  return (
    <ActionsContext.Provider
      value={{
        ...actions,
        run,
        exportSession,
        share: setShareId,
        rename: (session) => {
          setRenaming(session);
          setTitle(getSessionDisplayTitle(session.title, t("newChat")));
        },
      }}
    >
      {children}
      <Dialog
        open={Boolean(renaming)}
        onClose={closeRename}
        title={t("rename")}
        closeOnBackdropClick
        headerAction={
          <IconButton
            label={common("close")}
            icon={<X size={16} />}
            onClick={closeRename}
          />
        }
      >
        <form
          className="space-y-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!renaming || !title.trim()) return;
            const nextTitle = title.trim();
            const originalDisplayTitle = getSessionDisplayTitle(
              renaming.title,
              t("newChat"),
            );
            if (nextTitle !== originalDisplayTitle)
              actions.onRename(renaming.id, nextTitle);
            closeRename();
          }}
        >
          <label className="block space-y-2 text-sm">
            <span>{t("chatTitle")}</span>
            <input
              name="session-title"
              autoComplete="off"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={CHAT_ENTITY_LIMITS.maxSessionTitleChars}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={closeRename}>{common("cancel")}</Button>
            <Button type="submit" disabled={!title.trim()}>
              {common("save")}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={Boolean(error)}
        onClose={() => setError(null)}
        title={t("chatActions")}
        closeOnBackdropClick
        headerAction={
          <IconButton
            label={common("close")}
            icon={<X size={16} />}
            onClick={() => setError(null)}
          />
        }
      >
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      </Dialog>
      {shareId && (
        <ShareDialog sessionId={shareId} onClose={() => setShareId(null)} />
      )}
    </ActionsContext.Provider>
  );
}

export function SessionActionsMenu({
  session,
  anchor,
  onClose,
  returnFocus,
}: {
  session: Session;
  anchor?: { x: number; y: number };
  returnFocus?: HTMLElement;
  onClose?: () => void;
}) {
  const actions = useContext(ActionsContext);
  const t = useTranslations("Sidebar");
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const workspaces = useChatStore((state) => state.workspaces);
  const moveSession = useChatStore((state) => state.moveSessionToWorkspace);
  const sharingAvailable = useSettingsStore((state) =>
    Boolean(state.serverConfig?.sharing?.available),
  );
  if (!actions) return null;
  const temporary = isTemporarySession(session);
  const hasMessages = session.messageCount > 0;
  const displayTitle = getSessionDisplayTitle(session.title, t("newChat"));
  const close = () => {
    setOpen(false);
    setConfirmingDelete(false);
    onClose?.();
  };
  const select = (action: () => void | Promise<void>) => {
    close();
    actions.run(action);
  };
  return (
    <DropdownMenu
      open={anchor ? true : open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) close();
      }}
    >
      {anchor ? (
        <DropdownMenuTrigger asChild>
          <Button
            variant="bare"
            aria-label={t("chatActions")}
            className="fixed h-px w-px opacity-0"
            style={{ top: anchor.y, left: anchor.x }}
          />
        </DropdownMenuTrigger>
      ) : (
        <Tooltip content={t("chatActions")} position="left">
          <DropdownMenuTrigger asChild>
            <Button
              variant="bare"
              aria-label={t("moreActionsAria", { title: displayTitle })}
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Ellipsis size={18} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
      )}
      <DropdownMenuContent
        align={anchor ? "start" : "end"}
        sideOffset={anchor ? 0 : 8}
        className="w-52"
        onCloseAutoFocus={(event) => {
          if (anchor && returnFocus?.isConnected) {
            event.preventDefault();
            returnFocus.focus();
          }
        }}
      >
        {hasMessages && !temporary && (
          <>
            <DropdownMenuItem
              onSelect={() => select(() => actions.onTogglePin?.(session.id))}
            >
              {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              {session.pinned ? t("unpin") : t("pin")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={actions.duplicateDisabled}
              onSelect={() => select(() => actions.onDuplicate?.(session.id))}
            >
              <Copy size={14} />
              {t("duplicate")}
            </DropdownMenuItem>
          </>
        )}
        {hasMessages && (
          <DropdownMenuItem
            onSelect={() => select(() => actions.exportSession(session))}
          >
            <FileOutput size={14} />
            {t("export")}
          </DropdownMenuItem>
        )}
        {hasMessages && !temporary && sharingAvailable && (
          <DropdownMenuItem
            onSelect={() => select(() => actions.share(session.id))}
          >
            <Share2 size={14} />
            {t("share")}
          </DropdownMenuItem>
        )}
        {hasMessages && <DropdownMenuSeparator />}
        {!temporary && (
          <>
            <DropdownMenuItem
              onSelect={() => select(() => actions.rename(session))}
            >
              <PenLine size={14} />
              {t("rename")}
            </DropdownMenuItem>
            {hasMessages && (
              <DropdownMenuItem
                className="text-purple-600 dark:text-purple-400"
                onSelect={() =>
                  select(() => actions.onSmartRename?.(session.id))
                }
              >
                <Sparkles size={14} />
                {t("aiRename")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput size={14} />
                {t("moveTo")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                className="max-h-60 w-52 overflow-y-auto"
                aria-label={t("moveToWorkspaceAria")}
              >
                <DropdownMenuRadioGroup
                  value={session.workspaceId ?? ""}
                  onValueChange={(id) =>
                    select(() => moveSession(session.id, id || null))
                  }
                >
                  <DropdownMenuRadioItem value="">
                    {t("chatListRoot")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  {workspaces.map((workspace) => (
                    <DropdownMenuRadioItem
                      key={workspace.id}
                      value={workspace.id}
                    >
                      <Folder size={14} />
                      <span className="truncate">{workspace.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                  {!workspaces.length && (
                    <p className="px-2 py-2 text-xs text-muted-foreground">
                      {t("noWorkspaces")}
                    </p>
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          variant="destructive"
          aria-label={
            confirmingDelete
              ? t("confirmDeleteAria", { title: displayTitle })
              : t("deleteAria", { title: displayTitle })
          }
          onSelect={(event) => {
            if (!confirmingDelete && !temporary) {
              event.preventDefault();
              setConfirmingDelete(true);
              return;
            }
            select(() => actions.onDelete(session.id));
          }}
        >
          {confirmingDelete ? <Check size={14} /> : <Trash2 size={14} />}
          {temporary
            ? t("endTemporary")
            : confirmingDelete
              ? t("confirmDelete")
              : t("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
