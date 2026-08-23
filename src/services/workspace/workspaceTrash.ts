import { v7 as uuidv7 } from "uuid";

import {
  getWorkspaceFileName,
  type WorkspaceResult,
} from "@/lib/agent/workspace";

import {
  getWorkspaceFileEntry,
  moveWorkspaceFile,
  type WorkspaceFileEntry,
} from "./sessionWorkspace";

export const WORKSPACE_TRASH_DIRECTORY = "trash";

export async function trashWorkspaceFile(
  sessionId: string,
  path: unknown,
  expectedRevision?: string,
): Promise<
  WorkspaceResult<{
    originalPath: string;
    trashPath: string;
    entry: WorkspaceFileEntry;
  }>
> {
  const current = await getWorkspaceFileEntry(sessionId, path);
  if (!current.ok) return current;
  const trashPath = `${WORKSPACE_TRASH_DIRECTORY}/${uuidv7()}-${getWorkspaceFileName(
    current.value.path,
  )}`;
  const moved = await moveWorkspaceFile(
    sessionId,
    current.value.path,
    trashPath,
    false,
    expectedRevision,
  );
  if (!moved.ok) return moved;
  return {
    ok: true,
    value: {
      originalPath: current.value.path,
      trashPath,
      entry: moved.value.entry,
    },
  };
}

export async function restoreWorkspaceFile(
  sessionId: string,
  trashPath: unknown,
  destinationPath: unknown,
  expectedRevision?: string,
): Promise<WorkspaceResult<{ trashPath: string; entry: WorkspaceFileEntry }>> {
  const current = await getWorkspaceFileEntry(sessionId, trashPath);
  if (!current.ok) return current;
  if (!current.value.path.startsWith(`${WORKSPACE_TRASH_DIRECTORY}/`)) {
    return {
      ok: false,
      error: {
        code: "WORKSPACE_INVALID_PATH",
        message: "Only files in the workspace trash can be restored.",
      },
    };
  }
  const restored = await moveWorkspaceFile(
    sessionId,
    current.value.path,
    destinationPath,
    false,
    expectedRevision,
  );
  if (!restored.ok) return restored;
  return {
    ok: true,
    value: { trashPath: current.value.path, entry: restored.value.entry },
  };
}
