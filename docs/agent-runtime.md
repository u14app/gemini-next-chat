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
  lease prevents duplicate execution in multiple tabs. The lease is reentrant
  inside its owning tab, so a foreground chat run can safely create nested
  planning or research runs. Each nested run checkpoints and releases only its
  own lease entry.

## Deep Research tasks

Deep Research is a first-class chat mode, separate from Agent mode. It reuses
the trusted stream, lease, checkpoint, and Tool journal primitives, but it does
not receive the Agent system prompt, Agent Skills, dynamic Tool discovery,
Memory tools, JavaScript, workspace mutations, or an Agent run card. Research
chat messages retain only their ResearchTask reference; nested planning and
execution journals are labelled `research` and are not attached through
`generation.agentRunId`. A model without Tool Calling support cannot enable
Research.

The workflow has three fail-closed Tool surfaces:

- Start offers only `start_deep_research` and ends as soon as that call
  succeeds. Ordinary model prose is discarded; omitting or failing the call
  produces a recoverable launch error.
- Plan first offers only `request_user_input` for one clarification request of
  at most three questions. A second planning call then receives only an
  optional, separately budgeted public web reconnaissance allowance.
  Reconnaissance is limited to two `web_search` calls, five summary results per
  query, and 30 seconds. It cannot fetch page bodies or access knowledge,
  attachments, workspace files, Plugins, MCP, Skills, or Memory, and its
  summaries are never formal evidence. A final plan critique runs with all
  Tools disabled.
- Execute offers only the frozen source snapshot: read-only web search and URL
  reads, approved knowledge/attachment/workspace reads, and approved read-only
  Plugin or MCP functions. Registration and invocation both reject effects
  outside `local_read` and `network_read`.

The browser injects session and message identity out of band through the
research emitter bridge. The model cannot supply or override that host context,
and research task lifecycle calls do not use the generic plugin execution
route.

Every task prepares an immutable, versioned plan before source-body access. A
clear question may skip clarification, but it cannot skip explicit plan
approval. The structured plan records objective, audience and time scope,
assumptions, deliverable contract, stable research steps, query topics, source
priorities, evidence criteria, breadth/depth/query limits, completion criteria,
and the disclosed reconnaissance log. Natural-language or advanced-control
adjustments append another plan version and require approval again. The plan
card shows this strategy plus the resolved search, URL-fetch, knowledge,
attachment, workspace, and plugin source scope before execution.

Approved execution is host-orchestrated as bounded research waves rather than
one opaque Tool loop. Each report run persists its frontier, waves, research
nodes, learning packets, claim ledger, query/source usage, coverage, checkpoint,
and structured stop reason. A wave generates distinct queries from current
gaps, searches in bounded parallel batches, reads selected full sources,
commits provenance, extracts learnings, and proposes follow-up nodes. Follow-up
breadth halves at each deeper level. In-scope nodes continue automatically;
source or semantic scope expansion pauses for a new plan approval.

Approval freezes the model, reasoning and approval settings, read-only Tool and
Plugin allowlists, knowledge collections, attachment IDs, and workspace file
IDs for that report run. Approved session-workspace sources are additionally
frozen by exact path, revision, and content hash; list/search/read results are
restricted to those paths, and the controller revalidates them before every
wave. Skills and Memory are always excluded.

Research budgets are bounded by the lower value from the selected preset and
the Agent Profile:

| Preset   | Tool rounds | Tool calls | Active wall time |
| -------- | ----------- | ---------- | ---------------- |
| Quick    | 6           | 20         | 5 minutes        |
| Standard | 12          | 50         | 15 minutes       |
| Deep     | 20          | 100        | 30 minutes       |

The presets also resolve an execution strategy:

| Preset   | Initial breadth | Max depth | Query cap | Results/query |
| -------- | --------------- | --------- | --------- | ------------- |
| Quick    | 2               | 1         | 6         | 5             |
| Standard | 4               | 2         | 16        | 5             |
| Deep     | 6               | 3         | 32        | 5             |

Advanced controls clamp breadth to 1–8, depth to 1–4, the query cap to 2–48,
and results per query to 3–10. Exploration may consume at most 80% of Tool-call
capacity. It reserves `max(2, ceil(query cap × 15%))` queries from exploration,
while verification may use every query still unused, and keeps at least two
model rounds for verification and synthesis. Full-source reads are bounded by
`min(query cap × 2, 64, remaining exploration Tool calls)`. With default
settings, the approximate worst case is 2 batched searches plus 12 source reads
for Quick, 4 plus 32 for Standard, and 8 plus 64 for Deep.

An optional Profile token limit remains a hard limit. Pause and resume keep the
same report-run budget and reuse only committed, hashed Tool results. Continue
Research and Update Latest create a new report run with a new preset budget
while task-level usage remains cumulative.

Only `local_read` and `network_read` effects are exposed during source
collection. Unknown, write, destructive, publication, permission, and external
write effects are filtered before discovery and checked again at invocation.
Plan approval does not bypass the normal Agent approval policy. Search summaries
remain discovery-only; formal evidence records require a committed source body
or local content reference.

The complete report is stored as an immutable, content-addressed Research
Artifact and rendered in the Research workbench. Completed chat copies share
that Artifact until the last referencing ResearchTask is removed. Chat messages
keep only the task reference and summary card. Evidence records contain source
identity, locator, retrieval time, content hash, run, node, step and Tool
references, claim links, stance, freshness, authority, and availability. A
primary source may directly verify its own material statement; other material
claims require two independent, non-mirrored publishers. The host computes
coverage from this claim ledger, runs synthesis without Tools, and audits every
citation before publishing. Unsupported key findings, unresolved conflicts,
unavailable required sources, discovery-only results, or exhausted budgets
produce a partially completed report with explicit gaps.

Research execution is foreground-only. It can continue after switching chats,
and ordinary chat generation remains available, but each browser tab owns at
most one active research task. Refreshing or closing the page interrupts the
task and reopening the app requires a manual resume. A read call already in
flight may finish and commit before a safe pause; the next model round is not
dispatched. The current implementation uses the shared internal streaming
runtime and does not claim hosted background execution, webhooks, or an
OpenAI-native remote research job.

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
