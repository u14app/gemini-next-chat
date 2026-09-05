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

## Public webpage reading

The built-in URL reader fetches public webpages directly with a 15-second
deadline, a 2 MiB response limit and a 40,000-character readable-text limit.
Every target and redirect passes the public-address policy.

The Jina Reader plugin first tries Jina for up to 15 seconds. A service network
failure, stage timeout, service 5xx or service-level challenge permits one direct
read of the original public URL. The direct attempt has at most 15 seconds within
the same 30-second total deadline, uses the strict public-address policy, and
never receives Jina credentials. A user cancellation or expired total deadline
stops both stages. No additional provider is contacted.

Explicit original-site authentication or verification requirements stop reading;
ordinary Jina 401, 403 and 429 responses do not trigger the fallback solely because
of their status. Challenge pages and Jina application errors are rejected even
when their HTTP status is 200, before they can become research evidence. The
direct fallback provides readable static content and does not execute webpage
JavaScript. Its result identifies the final source URL and any truncation.

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
  succeeds. When the model omits the call, the host uses the existing deterministic
  start fallback through the same tool/emitter path.
- Planning starts with all tools disabled. A familiar topic produces a plan in
  this first call. Only a validated `needs_context` result for an unidentified
  subject or concept opens selected knowledge lookup; if still unresolved, it
  opens public web search. Missing verification or current data belongs to the
  approved research, and does not itself trigger planning retrieval.
  Each lookup stage allows at most two queries, five passages or summary results
  per query. Knowledge lookup has a 30-second deadline; web lookup has a shared
  90-second deadline covering model waiting, queueing, and requests. Web queries
  must exactly match queries fixed before
  reading private knowledge. Planning cannot fetch pages, ordinary attachments,
  workspace files, Plugins, MCP, Skills, or Memory. Lookup results are planning
  context, never formal evidence; unavailable lookups lead to explicit assumptions.
  Malformed responses are repaired with tools disabled. After the plan appears,
  the source-free clarification surface can adjust or explicitly approve it.
- Execute offers only the frozen source snapshot: read-only web search and URL
  reads, approved knowledge/attachment/workspace reads, and approved read-only
  Plugin or MCP functions. Registration and invocation both reject effects
  outside `local_read` and `network_read`.

The browser injects session and message identity out of band through the
research emitter bridge. The model cannot supply or override that host context,
and research task lifecycle calls do not use the generic plugin execution
route.

Every task prepares an immutable, versioned plan before approved research.
Only bounded concept lookup can precede approval; full research always requires
explicit plan approval. The structured plan records objective, audience and time scope,
explicit preferred or excluded web domains, assumptions, deliverable contract,
stable research steps, query topics, source priorities, evidence criteria,
breadth/depth/query limits, completion criteria, and the disclosed
reconnaissance log. Natural-language or advanced-control adjustments append
another plan version and require approval again. The plan card shows this
strategy plus the resolved search, URL-fetch, knowledge, attachment, workspace,
and plugin source scope before execution. Approved absolute dates and domain
constraints are applied by the host at Tool invocation time; model-supplied
filters may narrow them but cannot widen them.

Research templates can supply the initial deliverable, required sections,
source priorities, and bounded strategy. Their effective precedence is the
default, Workspace, Profile, session, then task-plan layer. An unset layer
inherits; an explicit `null` means no template. The selected template is copied
into a task snapshot when planning starts, so later template revisions or
deletions do not change an active task. Template source priorities are planning
defaults only: they cannot enable a Plugin, widen a source snapshot, or raise a
budget.

Approved execution is host-orchestrated as bounded research rounds (internally
`waves`) rather than
one opaque Tool loop. Each report run persists its frontier, waves, research
nodes, learning packets, claim ledger, query/source usage, coverage, checkpoint,
and structured stop reason. A wave generates distinct queries from current
gaps, searches in bounded parallel batches, reads selected full sources,
commits provenance, extracts learnings, and proposes follow-up nodes. The first
wave uses the approved breadth; later breadth starts from the depth-based decay
and expands only as needed for uncovered required steps and unresolved major
claims, within the existing cap. Exact and high-similarity query variants share
one query-budget identity. In-scope nodes continue automatically; source or
semantic scope expansion is handled by the existing scope-approval pause. A
source-expansion follow-up may refresh the frozen snapshot only with source
types and read-only functions already authorized by the conversation; it cannot
grant a new permission. The snapshot records each specialized source function's
definition fingerprint and dispatch rechecks it before use.

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

Verification may run multiple bounded waves while reserve queries remain, but
only continues when the preceding verification wave produced a newly verified
claim. Exploration distinguishes two consecutive waves without new sources from
two without newly verified claims; a reserved verification wave ends the loop
as soon as it adds no newly verified claim. Two consecutive degraded archive
waves stop as invalid model output. Coverage is complete only at 100%, while a
run may stop as sufficient once every required high-priority step is covered and
at least 80% of major claims are verified. Remaining disputes stay visible in
the report instead of forcing budget exhaustion.

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

The built-in arXiv, PubMed, EPO OPS, and SEC EDGAR adapters expose separate
read-only search and read operations. They use fixed official HTTPS endpoints;
source IDs, dates, and approved domains are checked before dispatch. Search
returns discovery records, while only a committed read can become formal
evidence. Credentials stay in the encrypted local Plugin secret store and are
excluded from prompts, templates, evidence, and snapshots. EPO OPS uses a
client ID and client secret; SEC EDGAR uses a contact-bearing User-Agent;
PubMed accepts an optional API key; arXiv needs no key. See
[Deep Research workflows](research-workflows.md) for provider coverage limits
and configuration details.

While exploration is running, the workbench can enqueue a same-level priority
change or a new question for an existing plan step. The execution owner applies
durable commands only after a wave and its checkpoint have been committed and
before stop evaluation, under the task Web Lock. Other tabs may submit commands
but cannot apply them. Scheduled nodes, verification, synthesis, terminal runs,
and unavailable durable storage reject or disable steering with a reason. An
accepted new question prevents a soft early-stop until it has been attempted,
subject to the existing budget, error, and cancellation rules. Refreshing still
requires an explicit resume.

Reports are stored as immutable, content-addressed Research Artifacts. Both
completed and partially completed reports have a document block in chat and can
be read or exported from the workbench; chat messages retain references rather
than duplicated report bodies. Copies share an Artifact until its last
referencing task is removed.

Synthesis runs without tools and prioritizes a usable report. Source-backed
findings, unverified material, and model-knowledge supplements must remain
visibly distinct. Knowledge supplements never become evidence or verified
coverage. With no citable evidence, the report can explain concepts and
conditional analysis, but cannot invent sources or claim current facts are
verified. Quality notices and gaps are included in the same Markdown used by
chat, workbench, snapshots, and exports.

The report delivery module performs one static audit, without a pre-publication
model rewrite. It preserves completed text or, after a non-user interruption,
received streaming text; only missing text invokes deterministic salvage from
existing material and the approved plan. Quality gaps produce warnings and a
`partial_completed` state, not a publication gate. User pause/cancel and real
core-storage failures still take precedence. Publication reads back the exact
report and Artifact identity before reporting success.

Evidence records retain their source identity, locator, retrieval time, content
hash, run/node/step/tool relationships, claim links, authority, freshness, and
availability. The source contract includes both new and reread canonical evidence
in the current round, without counting rereads as new sources. A frozen index
maps registered source/evidence/alias IDs exactly to S1–S80 for archive and repair;
unknown or ambiguous references are rejected. A single closed-book repair retains
already accepted packets. Verification and coverage rules remain authoritative
for evidence quality, independently of whether a report can be delivered.

Publication also attempts to freeze a report-version evidence snapshot containing the
report Markdown, evidence records, citation mapping, report gaps, and the run's claim ledger. The
workbench can create multiple independent question topics for that exact
version. Snapshot save failure does not block the report, but disables that
version's question feature. Every new report records whether its snapshot is
available; missing snapshots are not rebuilt from later evidence. Each answer uses only that snapshot and completed turns from the same
topic; tools, network access, Memory, and Research startup are disabled. The
host validates citations against the frozen source locators and rejects invalid
answers. Older report versions use their own snapshot or a limited
reconstruction from that version's run, never the task's latest evidence.
Snapshot and topic records live in the local Research extension store and follow
task deletion and session-copy lifecycle rules.

Research execution is foreground-only. It can continue after switching chats,
and ordinary chat generation remains available, but each browser tab owns at
most one active research task. Refreshing or closing the page interrupts the
task. On reopening, the global Research bar offers the newest checkpointed task
for explicit one-click resume; execution never resumes automatically. A read
call already in flight may finish and commit before a safe pause; the next model
round is not dispatched. The current implementation uses the shared internal
streaming runtime and does not claim hosted background execution, a task queue,
webhooks, or an OpenAI-native remote research job.

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
