import { v7 as uuidv7 } from "uuid";
import type { ResearchTask } from "@/lib/research/types";
import type {
  ResearchEvidenceSnapshot,
  ResearchEvidenceThread,
} from "@/lib/research/evidenceConversations";
import {
  parseEvidenceSnapshot,
  parseEvidenceThread,
} from "./evidenceConversations";
import {
  getResearchExtensionRepository,
  type ResearchExtensionKind,
  type ResearchExtensionRepository,
} from "./extensionRepository";

const TASK_KINDS: ResearchExtensionKind[] = [
  "task_template",
  "source_contracts",
  "steering",
  "evidence_snapshot",
  "evidence_thread",
];

export async function pruneResearchExtensions(
  tasks: readonly ResearchTask[],
  repository = getResearchExtensionRepository(),
  loadTask?: (taskId: string) => Promise<ResearchTask | null>,
) {
  const retained = new Set(tasks.map((task) => task.id));
  for (const kind of TASK_KINDS) {
    const records = await repository.list(kind);
    for (const record of records) {
      if (
        record.taskId &&
        !retained.has(record.taskId) &&
        !(loadTask && (await loadTask(record.taskId)))
      )
        await repository.remove(kind, record.id);
    }
  }
  for (const task of tasks) {
    const cleanUnpublished = async () => {
      const latest = loadTask ? await loadTask(task.id) : task;
      if (!latest) return;
      const published = new Set(
        latest.reportVersions.map((report) => report.id),
      );
      for (const kind of ["evidence_snapshot", "evidence_thread"] as const) {
        for (const record of await repository.list(kind, { taskId: task.id })) {
          if (record.reportId && !published.has(record.reportId))
            await repository.remove(kind, record.id);
        }
      }
    };
    // A publisher may have saved its snapshot but not its core report pointer yet.
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request(
        `research-execution:${task.id}`,
        { ifAvailable: true },
        async (lock) => {
          if (lock) await cleanUnpublished();
        },
      );
    } else if (typeof window === "undefined") {
      await cleanUnpublished();
    }
  }
}

/** Clone immutable evidence as it was saved, never reconstruct it from today's task. */
export async function cloneResearchExtensions(
  source: ResearchTask,
  target: ResearchTask,
  repository: ResearchExtensionRepository = getResearchExtensionRepository(),
) {
  const runIds = new Map(
    source.reportRuns.map((run, index) => [
      run.id,
      target.reportRuns[index]?.id,
    ]),
  );
  const reportIds = new Map(
    source.reportVersions.map((report, index) => [
      report.id,
      target.reportVersions[index]?.id,
    ]),
  );
  const evidenceIds = new Map(
    source.evidence.map((item, index) => [item.id, target.evidence[index]?.id]),
  );
  const mapEvidence = (id: string): string => {
    let mapped = evidenceIds.get(id);
    if (!mapped) {
      mapped = uuidv7();
      evidenceIds.set(id, mapped);
    }
    return mapped;
  };
  for (const kind of ["task_template", "source_contracts"] as const) {
    const value = await repository.get(kind, source.id);
    if (value !== null)
      await repository.put(kind, target.id, value, {
        taskId: target.id,
        sessionId: target.sessionId,
      });
  }
  const snapshots = await repository.list("evidence_snapshot", {
    taskId: source.id,
  });
  for (const record of snapshots) {
    const snapshot = parseEvidenceSnapshot(record.value);
    if (!snapshot) continue;
    const reportId = reportIds.get(snapshot.reportId);
    const report = target.reportVersions.find((item) => item.id === reportId);
    if (!report) continue;
    const cloned: ResearchEvidenceSnapshot = {
      ...snapshot,
      id: report.id,
      taskId: target.id,
      sessionId: target.sessionId,
      reportId: report.id,
      runId: report.researchRunId,
      artifactId: report.artifactId,
      citations: Object.fromEntries(
        Object.entries(snapshot.citations).map(([label, ids]) => [
          label,
          ids.map(mapEvidence),
        ]),
      ),
      evidence: snapshot.evidence.map((item) => ({
        ...item,
        id: mapEvidence(item.id),
        agentRunId: undefined,
        toolCallId: undefined,
        relations: item.relations?.map((relation) => ({
          ...relation,
          researchRunId:
            runIds.get(relation.researchRunId) ?? relation.researchRunId,
        })),
      })),
      claims: snapshot.claims.map((claim) => ({
        ...claim,
        supportingEvidenceIds: claim.supportingEvidenceIds.map(mapEvidence),
        contradictingEvidenceIds:
          claim.contradictingEvidenceIds.map(mapEvidence),
      })),
    };
    await repository.put("evidence_snapshot", report.id, cloned, {
      taskId: target.id,
      sessionId: target.sessionId,
      reportId: report.id,
    });
  }
  for (const record of await repository.list("evidence_thread", {
    taskId: source.id,
  })) {
    const thread = parseEvidenceThread(record.value);
    const reportId = thread && reportIds.get(thread.reportId);
    if (!thread || !reportId) continue;
    const cloned: ResearchEvidenceThread = {
      ...thread,
      id: uuidv7(),
      taskId: target.id,
      sessionId: target.sessionId,
      reportId,
      turns: thread.turns.map((turn) => ({
        ...turn,
        id: uuidv7(),
        requestId: uuidv7(),
        status: turn.status === "generating" ? "interrupted" : turn.status,
      })),
    };
    await repository.put("evidence_thread", cloned.id, cloned, {
      taskId: target.id,
      sessionId: target.sessionId,
      reportId,
    });
  }
  // Completed copies retain the adjustment audit trail, but never replay commands.
  for (const record of await repository.list<{
    taskId: string;
    runId: string;
    nextSequence: number;
    closed: boolean;
    commands: Array<{
      id: string;
      taskId: string;
      runId: string;
      status: string;
    }>;
  }>("steering", { taskId: source.id })) {
    const runId = runIds.get(record.value.runId);
    if (!runId || !Array.isArray(record.value.commands)) continue;
    const cloned = {
      ...record.value,
      taskId: target.id,
      runId,
      closed: true,
      commands: record.value.commands
        .filter((command) => command.status === "applied")
        .map((command) => ({
          ...command,
          id: uuidv7(),
          taskId: target.id,
          runId,
        })),
    };
    await repository.put("steering", runId, cloned, {
      taskId: target.id,
      sessionId: target.sessionId,
    });
  }
}
