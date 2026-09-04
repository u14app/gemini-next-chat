import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

import type {
  ResearchEvidenceSnapshot,
  ResearchEvidenceThread,
} from "@/lib/research/evidenceConversations";
import { claimSchema, evidenceSchema } from "./taskRepository/schema/run";
import {
  getResearchExtensionRepository,
  type ResearchExtensionRepository,
} from "./extensionRepository";

const id = z.string().min(1).max(240);
const timestamp = z.number().finite().nonnegative();
const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  taskId: id,
  sessionId: id,
  reportId: id,
  runId: id,
  artifactId: z.string().min(1).max(512),
  reportMarkdown: z.string().min(1),
  gaps: z.array(z.string()),
  evidence: z.array(evidenceSchema).max(2_000),
  claims: z.array(claimSchema),
  citations: z.record(z.string(), z.array(id)),
  createdAt: timestamp,
  origin: z.enum(["publication", "legacy_reconstruction"]),
});
const threadSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  taskId: id,
  sessionId: id,
  reportId: id,
  title: z.string().trim().min(1).max(160),
  createdAt: timestamp,
  updatedAt: timestamp,
  turns: z.array(
    z.object({
      id,
      requestId: id,
      question: z.string().min(1).max(8_000),
      answer: z.string(),
      status: z.enum([
        "generating",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
      ]),
      createdAt: timestamp,
      finishedAt: timestamp.optional(),
      model: z.string().optional(),
      errorCode: z.string().optional(),
    }),
  ),
});

export function parseEvidenceSnapshot(
  value: unknown,
): ResearchEvidenceSnapshot | null {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function parseEvidenceThread(
  value: unknown,
): ResearchEvidenceThread | null {
  const parsed = threadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function saveEvidenceSnapshot(
  snapshot: ResearchEvidenceSnapshot,
  repository: ResearchExtensionRepository = getResearchExtensionRepository(),
): Promise<ResearchEvidenceSnapshot> {
  const validated = snapshotSchema.parse(snapshot);
  const saved = await repository.update<ResearchEvidenceSnapshot>(
    "evidence_snapshot",
    snapshot.reportId,
    (previous) => {
      if (previous) {
        const existing = snapshotSchema.parse(previous);
        if (
          existing.taskId !== snapshot.taskId ||
          existing.artifactId !== snapshot.artifactId
        ) {
          throw new Error("Research report snapshot identity changed.");
        }
        return existing;
      }
      return validated;
    },
    {
      taskId: snapshot.taskId,
      sessionId: snapshot.sessionId,
      reportId: snapshot.reportId,
    },
  );
  return saved!;
}

export async function createEvidenceThread(
  snapshot: ResearchEvidenceSnapshot,
  title: string,
  repository: ResearchExtensionRepository = getResearchExtensionRepository(),
): Promise<ResearchEvidenceThread> {
  const now = Date.now();
  const thread: ResearchEvidenceThread = threadSchema.parse({
    schemaVersion: 1,
    id: uuidv7(),
    taskId: snapshot.taskId,
    sessionId: snapshot.sessionId,
    reportId: snapshot.reportId,
    title: title.trim().slice(0, 160),
    createdAt: now,
    updatedAt: now,
    turns: [],
  });
  await repository.put("evidence_thread", thread.id, thread, {
    taskId: thread.taskId,
    sessionId: thread.sessionId,
    reportId: thread.reportId,
  });
  return thread;
}

export async function updateEvidenceThread(
  threadId: string,
  update: (thread: ResearchEvidenceThread) => ResearchEvidenceThread,
  repository: ResearchExtensionRepository = getResearchExtensionRepository(),
): Promise<ResearchEvidenceThread | null> {
  return repository.update<ResearchEvidenceThread>(
    "evidence_thread",
    threadId,
    (value) => {
      const current = parseEvidenceThread(value);
      return current ? threadSchema.parse(update(current)) : null;
    },
  );
}

export async function listEvidenceThreads(taskId: string, reportId: string) {
  const records = await getResearchExtensionRepository().list(
    "evidence_thread",
    { taskId, reportId },
  );
  return records
    .flatMap((record) => {
      const thread = parseEvidenceThread(record.value);
      return thread && thread.taskId === taskId && thread.reportId === reportId
        ? [thread]
        : [];
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
