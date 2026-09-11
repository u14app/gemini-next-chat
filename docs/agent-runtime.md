# Trusted Agent Runtime

Agent mode is an opt-in, local-first runtime for foreground browser sessions.
This page is the contract for run state, tool permissions, recovery, and the
boundary between Agent and Deep Research.

## Operating model

An `AgentRun` is persisted in the browser (IndexedDB when available) and is the
source of truth for status, usage, activities, tool executions, evidence, and
stop reason. Its statuses are `running`, `awaiting_input`,
`awaiting_approval`, `interrupted`, `completed`, `failed`, and `cancelled`.
Stop reasons are structured values: `completed`, `user_stopped`,
`budget_exhausted`, `offline`, `page_interrupted`, `effect_unknown`, and
`runtime_error`.

The run journal records each tool as `prepared` → `running` → `committed`,
`failed`, or `effect_unknown`. It stores hashes and references rather than raw
prompts, arguments, or result bodies. A committed result is reused when its
reference is still verifiable; retries are limited to read-only or explicitly
idempotent work. An uncertain side effect is never replayed automatically.

Checkpoints are written around model activity and effects. One browser tab owns
the lease for a session; the lease is reentrant for nested runs in that tab, so
an Agent turn can start a Research planning run safely. Another tab cannot
execute the same session while the lease is live. Refreshing, closing the page,
going offline, or losing the executor interrupts foreground work; a persisted
run can be resumed only through an explicit UI action.

Usage accumulates across model rounds and includes tool rounds, tool calls,
tokens, and active wall time. When no profile or chat override supplies a
budget, the runtime fallback limits are 20 tool rounds and 100 tool calls. The
built-in Agent presets are:

| Preset   | Tool rounds | Tool calls | Active wall time |
| -------- | ----------: | ---------: | ---------------: |
| Light    |           8 |         30 |       10 minutes |
| Standard |          16 |         75 |       25 minutes |
| Extended |          24 |        150 |       45 minutes |

The selected profile or chat override determines the effective budget and can
add a hard token or duration limit. A custom value is validated before a new
round or call.

## Tools, trust, and approval

The host registers application-owned tools according to the active mode and
allowlists. Agent tools cover structured input, planning, web and knowledge
reads, document extraction, declarative Skills, bounded JavaScript, workspace
files, immutable Artifacts, and MCP resources/prompts. Plugin and MCP function
schemas are discovered with `search_tools` and loaded with `load_tools`; the
request contains at most 64 tool schemas. A missing or colliding function is an
explicit resolution error, never a guessed provider choice.

Every invocation carries effects, idempotency, sensitivity, origin, target
scope, and a definition fingerprint. The server validates canonical arguments
and the expected fingerprint again immediately before dispatch. Results use a
discriminated envelope with success or error, trust, provenance, references,
and effect receipts. Web, attachment, Plugin, and MCP content is
`external_untrusted`: retrieved instructions cannot become system instructions
or grant another capability.

| Invocation                                                       | Permissive behavior                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Local or network read                                            | Automatic when policy allows it                                         |
| Recoverable local write                                          | Automatic with revision checks and a receipt; strict mode may ask first |
| Trusted external write                                           | Automatic only in permissive mode with a visible target summary         |
| Destructive effect, credential exposure, or unknown MCP function | One-time confirmation; approval is never persisted                      |

Approval identity is bound to origin, provider/server, tool name, definition
fingerprint, effects, and target scope. MCP annotations are display hints and
never the security boundary. Built-in plugin IDs are reserved, and duplicate
function names are reported instead of resolved arbitrarily.

Skills are declarative text. They can narrow an already-authorized tool set,
but cannot grant tools, execute code, access the network or file system, or
receive plaintext secrets. `run_javascript` accepts bounded synchronous
computation inside the browser sandbox; it has no DOM or network access.

## Workspace and Artifacts

Workspace paths are relative to the session root and reject absolute paths,
traversal, control characters, invalid segments, and excessive depth. Manifest
entries carry MIME type, byte count, content hash, revision, source, and update
time. Mutations accept `expectedRevision`; a stale write fails with the latest
state instead of overwriting it. Trash is recoverable.

Scratch files remain mutable. `publish_artifact` creates an immutable,
content-addressed Artifact, so later edits cannot change an older message.
Session copies and deletion maintain Artifact references independently of
scratch files. Large results are stored as workspace or Artifact references and
only bounded summaries enter the model context.

## Public webpage reads

`fetch_url` reads public pages through the server URL policy. Each request has a
15-second deadline, a 2 MiB response limit, and a 40,000-character readable
text limit; every target and redirect is checked before it is fetched. The
reader returns the final URL and reports truncation.

The built-in Jina Reader first tries Jina for up to 15 seconds within a
30-second total deadline. Only a network failure, stage timeout, Jina 5xx, or
Jina service challenge permits one direct read of the original public URL. The
direct attempt uses the remaining time, the same public-address policy, and no
Jina credentials. A user cancellation, expired total deadline, target-site
authentication requirement, or target refusal stops the flow. A challenge page
or Jina application error is rejected even when its HTTP status is 200; the
direct fallback reads static content and does not run webpage JavaScript.

## Deep Research boundary

Deep Research is a separate first-class chat mode. It shares the stream,
checkpoint, lease, and journal primitives, but does not receive the Agent
system prompt, Agent Skills, Memory, JavaScript, workspace mutations, dynamic
tool discovery, or Agent run card. A model without Tool Calling support cannot
enable Research. Research chat messages retain only their `ResearchTask`
reference; planning and execution runs are labelled `research` and are not
attached to chat generation through `generation.agentRunId`.

Research start exposes only `start_deep_research` and stops after that call. If
the model omits it, the host emits the deterministic start fallback through the
same tool path. Planning has tools disabled except for bounded, validated
lookups needed to identify an unfamiliar subject. Full research requires
explicit plan approval; execution then uses a frozen source snapshot and
read-only effects. Plan approval does not bypass the normal Agent approval
policy. The host supplies session and message identity out of band, and
model-supplied filters may narrow approved domains and dates but cannot widen
them. See [Deep Research workflows](research-workflows.md) for templates, source
adapters, steering, reports, and report questions.

Research reports are immutable, content-addressed Artifacts. Synthesis runs
without tools and keeps source-backed findings, unverified material, and model
knowledge visibly separate. A partial report remains readable with its gaps.
Refreshing never launches network work automatically; a checkpoint is resumed
only after the user explicitly chooses Resume.

## Profiles and precedence

`AgentProfileV2` stores the model, reasoning and search settings, approval mode,
budgets, Plugin/tool/knowledge allowlists, Memory scopes, and Skill policies.
Configuration resolves in this order:

```text
global default → Workspace → Agent Profile → session override → turn reference
```

An explicit turn reference can narrow the effective capability set. Profile
snapshots keep local revisions, diffs, rollback, and fork metadata; credentials
and Agent run history are excluded from shareable profiles. Legacy assistants
migrate lazily to chat-only Profiles.

## Explicit non-goals

The runtime does not provide DOM automation, shell access, arbitrary local file
system access, executable Skills, Service Worker background execution,
scheduling, webhooks, hosted task queues, remote research jobs, or multi-agent
execution.
