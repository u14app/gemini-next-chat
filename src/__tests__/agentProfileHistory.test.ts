import { beforeEach, describe, expect, it } from "vitest";

import {
  diffAgentProfiles,
  normalizeAgentProfileRevision,
} from "../lib/assistant/profileHistory";
import { resolveAgentProfile } from "../lib/assistant/profile";
import { useAgentProfileRevisionStore } from "../store/core/agentProfileRevisionStore";

describe("Agent Profile revisions", () => {
  beforeEach(() => {
    useAgentProfileRevisionStore.setState({ revisionsByProfileId: {} });
  });

  it("produces field-level diffs without runtime history or credentials", () => {
    const before = resolveAgentProfile({
      runtime: { agentEnabled: true, approvalMode: "permissive" },
    });
    const after = resolveAgentProfile({
      runtime: { agentEnabled: true, approvalMode: "strict" },
      capabilities: { memoryScopes: [] },
    });

    expect(diffAgentProfiles(before, after)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "runtime.approvalMode" }),
        expect.objectContaining({ path: "capabilities.memoryScopes" }),
      ]),
    );
  });

  it("records versioned snapshots and makes an older snapshot rollback-ready", () => {
    const first = resolveAgentProfile({
      runtime: { agentEnabled: true, approvalMode: "permissive" },
    });
    const second = resolveAgentProfile({
      runtime: { agentEnabled: true, approvalMode: "balanced" },
    });
    const store = useAgentProfileRevisionStore.getState();
    store.recordRevision("profile-1", first);
    store.recordRevision("profile-1", second);

    const revisions =
      useAgentProfileRevisionStore.getState().revisionsByProfileId["profile-1"];
    expect(revisions.map((revision) => revision.sequence)).toEqual([2, 1]);
    expect(revisions[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "runtime.approvalMode" }),
      ]),
    );
    expect(revisions[1].profile.runtime.approvalMode).toBe("permissive");
  });

  it("rejects malformed persisted snapshots", () => {
    expect(
      normalizeAgentProfileRevision({
        id: "revision",
        profileId: "profile",
        sequence: 0,
        createdAt: 100,
        profile: {},
      }),
    ).toBeNull();
  });
});
