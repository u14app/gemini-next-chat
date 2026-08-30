import type { LearningPacket } from "../types";
import { formatZodIssues, parseJsonObjects } from "./json";
import { wavePacketSchema, waveEnvelopeSchema } from "./schemas";
import type {
  ParsedResearchWavePackets,
  ResearchWaveAliasContext,
} from "./types";

export interface ParseResearchWavePacketsOptions {
  aliases: ResearchWaveAliasContext;
  requestedNodeKeys?: readonly string[];
  existingClaimSignatures?: Readonly<Record<string, string>>;
  now?: number;
}

export function createPromptId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) return `${prefix}-${randomUuid()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function getResearchClaimSignature(
  _stepId: string,
  claimText: string,
): string {
  return claimText.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseResearchWavePackets(
  text: string,
  options: ParseResearchWavePacketsOptions,
): ParsedResearchWavePackets {
  const requestedNodeKeys = [
    ...(options.requestedNodeKeys ||
      options.aliases.nodes.map((node) => node.key)),
  ];
  const requestedNodeKeySet = new Set(requestedNodeKeys);
  const objects = parseJsonObjects(text);
  const envelopes = objects
    .map((object) => waveEnvelopeSchema.safeParse(object))
    .filter((candidate) => candidate.success);
  const envelope = envelopes.at(-1);
  if (!envelope?.success) {
    const lastObject = objects.at(-1);
    const parsedLastObject = lastObject
      ? waveEnvelopeSchema.safeParse(lastObject)
      : undefined;
    const issues =
      parsedLastObject && !parsedLastObject.success
        ? formatZodIssues(parsedLastObject.error)
        : ["root: Expected one JSON object."];
    return {
      valid: false,
      data: [],
      missingNodeKeys: requestedNodeKeys,
      invalidNodeKeys: [],
      error: {
        code: "RESEARCH_WAVE_INVALID",
        message: "The model did not return a JSON research wave packet.",
        issues,
      },
    };
  }
  const nodeByKey = new Map(
    options.aliases.nodes.map((node) => [node.key, node]),
  );
  const sourceByKey = new Map(
    options.aliases.sources.map((source) => [source.key, source]),
  );
  const issues: string[] = [];
  const attemptedNodeKeys = new Set<string>();
  const packetsByNodeKey = new Map<string, LearningPacket>();
  const claimIdBySignature = new Map(
    Object.entries(options.existingClaimSignatures || {}).map(
      ([claimId, signature]) => [signature, claimId],
    ),
  );
  for (const [packetIndex, rawPacket] of envelope.data.packets.entries()) {
    const inferredNodeKey =
      rawPacket &&
      typeof rawPacket === "object" &&
      "nodeKey" in rawPacket &&
      typeof rawPacket.nodeKey === "string"
        ? rawPacket.nodeKey
        : undefined;
    if (inferredNodeKey && requestedNodeKeySet.has(inferredNodeKey)) {
      attemptedNodeKeys.add(inferredNodeKey);
    }
    const parsedPacket = wavePacketSchema.safeParse(rawPacket);
    if (!parsedPacket.success) {
      issues.push(
        ...formatZodIssues(parsedPacket.error).map(
          (issue) => `packets.${packetIndex}.${issue}`,
        ),
      );
      continue;
    }
    const packet = parsedPacket.data;
    const node = nodeByKey.get(packet.nodeKey);
    if (!node || !requestedNodeKeySet.has(packet.nodeKey)) {
      issues.push(
        `packets.${packetIndex}.nodeKey: Unknown or unrequested node alias ${packet.nodeKey}.`,
      );
      continue;
    }
    attemptedNodeKeys.add(packet.nodeKey);
    if (packetsByNodeKey.has(packet.nodeKey)) {
      issues.push(
        `packets.${packetIndex}.nodeKey: Duplicate node alias ${packet.nodeKey}; the first valid packet was kept.`,
      );
      continue;
    }
    const packetIssues: string[] = [];
    const assessmentsBySourceKey = new Map<
      string,
      (typeof packet.sourceAssessments)[number]
    >();
    const mirrorBySourceKey = new Map<string, string>();
    for (const [
      assessmentIndex,
      assessment,
    ] of packet.sourceAssessments.entries()) {
      if (!sourceByKey.has(assessment.sourceKey)) {
        packetIssues.push(
          `sourceAssessments.${assessmentIndex}.sourceKey: Unknown source alias ${assessment.sourceKey}.`,
        );
      }
      if (assessmentsBySourceKey.has(assessment.sourceKey)) {
        packetIssues.push(
          `sourceAssessments.${assessmentIndex}.sourceKey: Duplicate source assessment.`,
        );
      }
      if (
        assessment.mirrorOfSourceKey &&
        !sourceByKey.has(assessment.mirrorOfSourceKey)
      ) {
        packetIssues.push(
          `sourceAssessments.${assessmentIndex}.mirrorOfSourceKey: Unknown source alias ${assessment.mirrorOfSourceKey}.`,
        );
      }
      if (assessment.mirrorOfSourceKey === assessment.sourceKey) {
        packetIssues.push(
          `sourceAssessments.${assessmentIndex}.mirrorOfSourceKey: A source cannot mirror itself.`,
        );
      }
      assessmentsBySourceKey.set(assessment.sourceKey, assessment);
      if (assessment.mirrorOfSourceKey) {
        mirrorBySourceKey.set(
          assessment.sourceKey,
          assessment.mirrorOfSourceKey,
        );
      }
    }
    for (const sourceKey of mirrorBySourceKey.keys()) {
      const visited = new Set<string>();
      let current: string | undefined = sourceKey;
      while (current) {
        if (visited.has(current)) {
          packetIssues.push(
            "sourceAssessments: Mirror relationship contains a cycle.",
          );
          break;
        }
        visited.add(current);
        current = mirrorBySourceKey.get(current);
      }
    }
    for (const [learningIndex, learning] of packet.learnings.entries()) {
      for (const sourceKey of learning.sourceKeys) {
        if (!sourceByKey.has(sourceKey)) {
          packetIssues.push(
            `learnings.${learningIndex}.sourceKeys: Unknown source alias ${sourceKey}.`,
          );
        }
      }
    }
    if (packetIssues.length > 0) {
      issues.push(
        ...packetIssues.map((issue) => `packets.${packetIndex}.${issue}`),
      );
      continue;
    }
    const usedSourceKeys = Array.from(
      new Set(packet.learnings.flatMap((learning) => learning.sourceKeys)),
    );
    for (const sourceKey of usedSourceKeys) {
      if (!assessmentsBySourceKey.has(sourceKey)) {
        assessmentsBySourceKey.set(sourceKey, {
          sourceKey,
          authority: "unknown",
          rationale: "No source assessment was provided by the model.",
        });
      }
    }
    const now = options.now ?? Date.now();
    packetsByNodeKey.set(packet.nodeKey, {
      id: createPromptId("learning-packet"),
      nodeId: node.nodeId,
      createdAt: now,
      learnings: packet.learnings.map((learning) => {
        const claimSignature = getResearchClaimSignature(
          node.stepId,
          learning.claim,
        );
        let claimId = claimIdBySignature.get(claimSignature);
        if (!claimId) {
          claimId = createPromptId("claim");
          claimIdBySignature.set(claimSignature, claimId);
        }
        const sources = Array.from(new Set(learning.sourceKeys)).map(
          (sourceKey) => sourceByKey.get(sourceKey)!,
        );
        return {
          id: createPromptId("learning"),
          claimId,
          claimText: learning.claim,
          stepId: node.stepId,
          importance: learning.importance,
          stance: learning.stance,
          statement: learning.finding,
          sourceIds: sources.map((source) => source.sourceId),
          evidenceIds: Array.from(
            new Set(sources.flatMap((source) => source.evidenceIds)),
          ),
        };
      }),
      sourceAssessments: Array.from(assessmentsBySourceKey.values()).map(
        (assessment) => ({
          sourceId: sourceByKey.get(assessment.sourceKey)!.sourceId,
          authority: assessment.authority,
          publisherId: assessment.publisherId || undefined,
          mirrorOfSourceId: assessment.mirrorOfSourceKey
            ? sourceByKey.get(assessment.mirrorOfSourceKey)!.sourceId
            : undefined,
          rationale: assessment.rationale,
        }),
      ),
      followUps: packet.followUps.map((followUp) => ({
        id: createPromptId("follow-up"),
        ...followUp,
      })),
    });
  }
  const missingNodeKeys = requestedNodeKeys.filter(
    (nodeKey) =>
      !packetsByNodeKey.has(nodeKey) && !attemptedNodeKeys.has(nodeKey),
  );
  const invalidNodeKeys = requestedNodeKeys.filter(
    (nodeKey) =>
      !packetsByNodeKey.has(nodeKey) && attemptedNodeKeys.has(nodeKey),
  );
  const data = requestedNodeKeys.flatMap((nodeKey) => {
    const packet = packetsByNodeKey.get(nodeKey);
    return packet ? [packet] : [];
  });
  if (missingNodeKeys.length > 0 || invalidNodeKeys.length > 0) {
    for (const nodeKey of missingNodeKeys) {
      issues.push(`packets: Missing packet for node alias ${nodeKey}.`);
    }
    return {
      valid: false,
      data,
      missingNodeKeys,
      invalidNodeKeys,
      error: {
        code: "RESEARCH_WAVE_INVALID",
        message: "The research wave archive is incomplete.",
        issues,
      },
    };
  }
  return {
    valid: true,
    data,
    missingNodeKeys: [],
    invalidNodeKeys: [],
  };
}

export function createDegradedResearchWavePackets({
  aliases,
  nodeKeys,
  now = Date.now(),
}: {
  aliases: ResearchWaveAliasContext;
  nodeKeys: readonly string[];
  now?: number;
}): LearningPacket[] {
  const requested = new Set(nodeKeys);
  return aliases.nodes
    .filter((node) => requested.has(node.key))
    .map((node) => ({
      id: createPromptId("learning-packet"),
      nodeId: node.nodeId,
      learnings: [],
      sourceAssessments: [],
      followUps: [],
      createdAt: now,
    }));
}

export function finalizeResearchWavePackets({
  aliases,
  initialPackets,
  repairedPackets,
  now = Date.now(),
}: {
  aliases: ResearchWaveAliasContext;
  initialPackets: readonly LearningPacket[];
  repairedPackets: readonly LearningPacket[];
  now?: number;
}): {
  packets: LearningPacket[];
  repairedNodeIds: string[];
  degradedNodeIds: string[];
} {
  const allowedNodeIds = new Set(aliases.nodes.map((node) => node.nodeId));
  const packetByNodeId = new Map(
    initialPackets
      .filter((packet) => allowedNodeIds.has(packet.nodeId))
      .map((packet) => [packet.nodeId, packet]),
  );
  const repairedNodeIds: string[] = [];
  for (const packet of repairedPackets) {
    if (
      !allowedNodeIds.has(packet.nodeId) ||
      packetByNodeId.has(packet.nodeId)
    ) {
      continue;
    }
    packetByNodeId.set(packet.nodeId, packet);
    repairedNodeIds.push(packet.nodeId);
  }
  const degradedNodeKeys = aliases.nodes
    .filter((node) => !packetByNodeId.has(node.nodeId))
    .map((node) => node.key);
  const degradedPackets = createDegradedResearchWavePackets({
    aliases,
    nodeKeys: degradedNodeKeys,
    now,
  });
  for (const packet of degradedPackets) {
    packetByNodeId.set(packet.nodeId, packet);
  }
  return {
    packets: aliases.nodes.flatMap((node) => {
      const packet = packetByNodeId.get(node.nodeId);
      return packet ? [packet] : [];
    }),
    repairedNodeIds,
    degradedNodeIds: degradedPackets.map((packet) => packet.nodeId),
  };
}
