import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type {
  ResearchEvidenceSnapshot,
  ResearchEvidenceThread,
} from "@/lib/research/evidenceConversations";
import {
  createEvidenceThread,
  listEvidenceThreads,
  updateEvidenceThread,
} from "@/services/research/evidenceConversations";
import {
  getResearchExtensionRepository,
  subscribeResearchExtensions,
} from "@/services/research/extensionRepository";
import {
  answerEvidenceQuestion,
  cancelEvidenceAnswer,
  deleteEvidenceThread,
  getLiveEvidenceAnswer,
  getOrCreateEvidenceSnapshot,
  recoverEvidenceThread,
  subscribeEvidenceAnswers,
} from "@/lib/research/runtime/evidenceConversation";

export function useEvidenceConversation(taskId: string, reportId?: string) {
  const [snapshot, setSnapshot] = useState<ResearchEvidenceSnapshot | null>(
    null,
  );
  const [threads, setThreads] = useState<ResearchEvidenceThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useSyncExternalStore(
    subscribeEvidenceAnswers,
    () => getLiveEvidenceAnswer(selectedId),
    () => null,
  );

  useEffect(() => {
    let alive = true;
    let revision = 0;
    setSnapshot(null);
    setThreads([]);
    setSelectedId(null);
    setError(null);
    if (!reportId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const refresh = async () => {
      const current = ++revision;
      try {
        const values = await listEvidenceThreads(taskId, reportId);
        if (!alive || current !== revision) return;
        setThreads(values);
        setSelectedId((id) =>
          values.some((item) => item.id === id) ? id : (values[0]?.id ?? null),
        );
        await Promise.all(values.map(recoverEvidenceThread));
      } catch {
        if (alive) setError("STORAGE_UNAVAILABLE");
      }
    };
    const unsubscribe = subscribeResearchExtensions(() => {
      void refresh();
    });
    void getOrCreateEvidenceSnapshot(taskId, reportId)
      .then(async (value) => {
        if (!alive) return;
        setSnapshot(value);
        await refresh();
      })
      .catch((failure: unknown) => {
        if (alive)
          setError(
            failure instanceof Error &&
              ["REPORT_UNAVAILABLE", "SNAPSHOT_UNAVAILABLE"].includes(
                failure.message,
              )
              ? failure.message
              : "STORAGE_UNAVAILABLE",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [taskId, reportId]);

  const perform = useCallback(async (operation: () => Promise<void>) => {
    setError(null);
    try {
      await operation();
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "GENERATION_FAILED",
      );
      return false;
    }
  }, []);

  const create = async (title: string) => {
    if (!snapshot) return;
    await perform(async () => {
      const thread = await createEvidenceThread(snapshot, title);
      setThreads((values) => [
        thread,
        ...values.filter((item) => item.id !== thread.id),
      ]);
      setSelectedId(thread.id);
    });
  };
  const ask = async (question: string, retryTurnId?: string) => {
    if (!snapshot) return false;
    return perform(async () => {
      let threadId = selectedId;
      if (!threadId) {
        const created = await createEvidenceThread(
          snapshot,
          question.slice(0, 160),
        );
        threadId = created.id;
        setThreads((values) => [created, ...values]);
        setSelectedId(threadId);
      }
      await answerEvidenceQuestion({
        taskId,
        reportId: snapshot.reportId,
        threadId,
        question,
        retryTurnId,
      });
    });
  };
  const rename = async (threadId: string, title: string) => {
    return perform(async () => {
      await updateEvidenceThread(threadId, (thread) => ({
        ...thread,
        title: title.trim(),
        updatedAt: Date.now(),
      }));
    });
  };
  const remove = async (threadId: string) => {
    await perform(async () => {
      await deleteEvidenceThread(threadId);
    });
  };
  const cancel = async () => {
    if (!selectedId) return;
    await perform(() => cancelEvidenceAnswer(selectedId));
  };
  return {
    snapshot,
    threads,
    selectedId,
    select: setSelectedId,
    loading,
    error,
    live,
    thread: threads.find((thread) => thread.id === selectedId),
    available: getResearchExtensionRepository().getStatus().durable,
    create,
    ask,
    rename,
    remove,
    cancel,
  };
}
