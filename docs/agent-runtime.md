# Trusted Agent Runtime

Neo Chat's Agent mode is a personal, local-first, browser-foreground runtime.
Closing the page interrupts the run; it does not create a background worker or
claim continued execution.

## Runtime facts

- `AgentRun` has independent running, input, approval, interrupted, completed,
  failed, and cancelled states. Completion, user stop, budget exhaustion,
  offline interruption, page interruption, unknown effects, and runtime errors
  are structured stop reasons rather than assistant prose.
- Each Tool call is journaled as `prepared`, `running`, then `committed`,
  `failed`, or `effect_unknown`. Committed calls reuse stored references;
  transparent retry is limited to read-only or explicitly idempotent calls.
- Token, wall-clock, Tool-round, and Tool-call usage aggregates across model
  rounds. Defaults remain 20 Tool rounds and 100 calls unless a Profile narrows
  them.
- Checkpoints are event-driven around activity and effects. A per-session tab
  lease prevents duplicate execution in multiple tabs.

## Effect and approval model

Descriptors combine effects, idempotency, sensitivity, origin, target scope,
and definition fingerprint. Dynamic policy may become stricter after canonical
arguments are known.

| Effect                                                                             | Permissive default                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------ |
| local/network read and pure computation                                            | automatic                                  |
| recoverable local write/move/overwrite                                             | automatic with revision and receipt        |
| trusted, non-destructive external write                                            | automatic with visible target/data summary |
| recoverable trash                                                                  | automatic with restore                     |
| permanent delete, payment, publication, permission change, credential exfiltration | one-time approval                          |
| unknown or unverifiable MCP Tool                                                   | one-time approval                          |

Session approval identity includes the Tool fingerprint, Plugin/MCP server,
effect, and target scope. Destructive approval is never persistent. MCP
annotations are displayed but are never trusted as the security boundary.

## Workspace, Artifacts, and content trust

Workspace manifest entries include path, MIME, bytes, content hash, revision,
source, and update time. Mutations accept `expectedRevision`; stale writes fail
with the latest state rather than overwriting it. Trash is recoverable.

Scratch files are mutable. Publishing creates an immutable content-addressed
Artifact, so an old message never changes when the scratch path is edited later.
Session duplication and deletion copy or release Artifact references separately
from scratch files. Large Tool payloads are written to the workspace; the model
receives a bounded summary and reference.

Every Tool response uses a discriminated result envelope carrying success or
error, trust, provenance, Artifact references, and effect receipts. Web,
attachments, Plugin, and MCP content is `external_untrusted`. Canonical JSON
Schema validation runs after model output and again immediately before external
dispatch.

## Agent Profiles, Skills, and discovery

`AgentProfileV2` stores persona-adjacent runtime preferences, model, Agent and
search/reasoning settings, approval mode, budgets, Plugin/Tool/knowledge
allowlists, scoped Memory, and three-state Skill policies. Precedence is global
default, Workspace, Profile, session override, then explicit turn references.
Legacy assistants migrate lazily to chat-only Profiles. Profile snapshots have
local revision history, field-level Diff, rollback selection, and local Fork;
credentials and Agent run history are not stored in the shareable Profile.

Skills are declarative text. Schema v2 carries publisher/source, version,
content hash, locales, runtime restrictions, required capabilities,
`allowedTools`, parameters, output contract, and eval cases. `allowedTools` only
narrows permission. `search_skills` returns metadata, `inspect_skill` returns the
contract, and only `load_skill` returns instructions.

Plugin/MCP function schemas use `search_tools` and `load_tools` to stay under the
64-schema request limit. Provider aliases make name collisions visible.
Resources and prompts preserve MCP title, icons, annotations, output schemas,
structured content, and opaque cursor pagination; their content remains
untrusted and cannot grant permission.

## Explicit non-goals

This runtime does not add DOM automation, shell access, arbitrary local file
system access, executable Skills, Service Worker pseudo-background execution,
automation schedules, or Multi-Agent execution.
