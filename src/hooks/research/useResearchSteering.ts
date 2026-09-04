"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";

import { getActivePlan, getActiveResearchReportRun } from "@/lib/research";
import {
  canSteerResearchTask,
  ResearchSteeringError,
  type ResearchSteeringIntent,
  type ResearchSteeringPriority,
  type ResearchSteeringRecord,
  type ResearchSteeringRejection,
} from "@/lib/research/steering";
import {
  enqueueResearchSteering,
  supportsResearchExecutionLock,
} from "@/lib/research/runtime/steering";
import {
  getResearchExtensionRepository,
  subscribeResearchExtensions,
} from "@/services/research/extensionRepository";
import { getResearchTaskRepository } from "@/services/research/runtime";
import { useResearchStore } from "@/store/core/researchStore";

export function useResearchSteering(taskId: string) {
  const task = useResearchStore((state) => state.tasksById[taskId]);
  const run = task ? getActiveResearchReportRun(task) : undefined;
  const plan = task ? getActivePlan(task) : undefined;
  const [record, setRecord] = useState<ResearchSteeringRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ResearchSteeringRejection | null>(null);
  const submitting = useRef(false);
  const identity = useRef(taskId);

  useEffect(() => {
    identity.current = taskId;
    let active = true;
    let generation = 0;
    setRecord(null);
    setLoading(true);
    setError(null);
    const load = async () => {
      const request = ++generation;
      try {
        const next = run?.id
          ? await getResearchExtensionRepository().get<ResearchSteeringRecord>(
              "steering",
              run.id,
            )
          : null;
        if (active && request === generation) setRecord(next);
      } catch {
        if (active && request === generation) setError("unavailable");
      } finally {
        if (active && request === generation) setLoading(false);
      }
    };
    void load();
    const unsubscribe = subscribeResearchExtensions(() => void load());
    return () => {
      active = false;
      identity.current = "";
      unsubscribe();
    };
  }, [taskId, run?.id]);

  const submit = useCallback(
    async (intent: ResearchSteeringIntent) => {
      if (submitting.current) return false;
      submitting.current = true;
      setBusy(true);
      setError(null);
      try {
        await enqueueResearchSteering(taskId, intent);
        return true;
      } catch (cause) {
        if (identity.current === taskId)
          setError(
            cause instanceof ResearchSteeringError ? cause.code : "unavailable",
          );
        return false;
      } finally {
        submitting.current = false;
        if (identity.current === taskId) setBusy(false);
      }
    },
    [taskId],
  );

  const available = Boolean(
    task &&
    canSteerResearchTask(task) &&
    record &&
    !record.closed &&
    supportsResearchExecutionLock() &&
    getResearchTaskRepository().getStatus().durable &&
    getResearchExtensionRepository().getStatus().durable,
  );
  return {
    task,
    run,
    plan,
    record,
    available,
    loading,
    busy,
    error,
    setPriority: (nodeId: string, priority: ResearchSteeringPriority) =>
      submit({ kind: "priority", nodeId, priority }),
    addQuestion: (stepId: string, question: string) =>
      submit({
        kind: "add",
        nodeId: `research-node-${uuidv7()}`,
        stepId,
        question,
      }),
  };
}
