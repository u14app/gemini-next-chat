# Deep Research workflows

Deep Research is a foreground chat mode for bounded, auditable research. It
first produces a structured plan, waits for explicit approval, and then runs
the approved plan in persisted waves. It is separate from Agent mode: Research
does not receive Agent Skills, Memory tools, JavaScript, workspace mutations,
or arbitrary Plugin functions. Refreshing a page interrupts a run; the global
Research bar offers an explicit resume after the page is opened again.

This guide describes the four Research extensions and their storage and trust
boundaries. The existing [agent runtime reference](agent-runtime.md) documents
the shared execution model and budget rules.

## Choose a research template

Templates are reusable, permission-free defaults. Each one contains a name,
description, deliverable kind, required sections, source priorities, bounded
strategy, and revision. The built-ins start with the Standard strategy
(initial breadth 4, maximum depth 2, query cap 16, and 5 results per query).

| Built-in             | Deliverable       | Required sections                                                                                                           | Initial source priority                                                                        |
| -------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Competitive analysis | `comparison`      | Comparison criteria; comparison matrix; differences and opportunities; conclusion                                           | Official first-party web sources, then specialist Plugins                                      |
| Literature review    | `research_report` | Search scope; thematic synthesis; evidence quality and disagreements; research gaps                                         | Scholarly Plugins, then official publication pages and approved knowledge                      |
| Due diligence        | `decision_memo`   | Entity and scope; key facts; risks and evidence gaps; items to verify; recommendation                                       | Disclosure Plugins, first-party web sources, and user attachments                              |
| Technical evaluation | `decision_memo`   | Requirements and evaluation criteria; option comparison; performance and maintenance risks; recommendation; validation plan | Authoritative product/standards web sources, specialist Plugins, and approved local references |

The standard report audit sections are retained in addition to template
sections. Source priorities influence the plan and query strategy; they do not
turn on a Plugin, add credentials, enlarge a budget, or widen the approved
source scope.

Open Research settings to select a template and preview its deliverable,
sections, sources, and strategy. Built-ins are read-only. Use **Duplicate** to
make an editable copy, then use the local template manager to create, edit,
copy, or delete custom templates. A current approved plan can also be saved as
a new template; this copies its deliverable, sections, source priorities, and
strategy rather than storing the task itself.

Template resolution follows the same precedence model as the surrounding chat
configuration:

```text
default → Workspace → Agent Profile → session → current task plan
```

An unset layer inherits the lower layer. Select **No template** to write an
explicit `null` and stop inheritance. A selected Profile stores a portable
template snapshot, including its revision; credentials, run history, and
source response data are not part of that snapshot. A task copies the resolved
template when planning begins. Editing or deleting a library template later
does not change that task. The plan remains authoritative after the template
has supplied its initial defaults, and explicit plan edits win over those
defaults.

Templates are kept in a separate local IndexedDB database named
`neo-chat-research-extensions` (schema version 1). This sidecar does not change
the core Research database version or its existing records. It is local-first;
the current implementation does not add ZIP export or cross-device template
sync.

## Use specialized read-only sources

The Plugin Market includes four trusted Research source adapters. Each adapter
has separate search and read operations. Search results are discovery records;
they do not become formal evidence. A successful read returns the actual
available document or record and may then be committed into the normal evidence
ledger. Empty searches create no evidence, and each hit keeps its own source
identity.

| Adapter                                                                                  | Search and read behavior                                                                                  | Configuration and coverage                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [arXiv](https://info.arxiv.org/help/api/user-manual.html)                                | Search preprints; read a versioned abstract and bibliographic metadata                                    | No key. The adapter does not fetch PDF or full-text content.                                                                                                                                                                             |
| [PubMed](https://dataguide.nlm.nih.gov/eutilities/utilities.html)                        | ESearch returns discovery IDs; read by PMID returns the PubMed record and available abstract              | NCBI API key is optional. A search hit is metadata-only until read; article full text is outside this adapter.                                                                                                                           |
| [EPO OPS](https://developers.epo.org/)                                                   | Search worldwide patents; read public DOCDB bibliographic data and an available abstract                  | Configure both the client ID and client secret. The server exchanges them for a short-lived token. Coverage is limited to the public data returned by OPS.                                                                               |
| [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | Search by company name, ticker, or CIK, with optional exact form and date range; read the returned filing | Configure a contact-bearing User-Agent. Search covers at most three matching companies and up to three matching historical index files per company. The response includes a `coverageNote`; this is not an all-company full-text search. |

The adapters run through `/api/plugins/execute` using registered built-in
definitions. Their functions are read-only and pass the existing
`local_read`/`network_read` policy. Official HTTPS hosts and path patterns are
fixed in the server adapter: a user-supplied Base URL or redirect is rejected.
Arguments are checked for provider-specific identifiers, dates, forms, and
limits. The server bounds response size and XML parsing, applies request
timeouts, cancellation, bounded retry, and provider-specific throttling.

When a Research plan includes a specialized source, the source definition and
function fingerprint are frozen with the task snapshot. Registration and every
dispatch recheck the fingerprint, so a changed definition requires a new
approved plan. The approved plan's source, domain, date, query, and tool budgets
still apply. A template or model cannot use source priorities to bypass them.

Provider credentials are entered in the Plugin Market and stored through the
existing encrypted local secret path. EPO's two values are stored as one
encrypted credential envelope; SEC's User-Agent is treated as a credential-like
secret; PubMed's optional API key is also kept out of Research data. None of
these values is sent to a prompt or written into a template, evidence record,
source contract, report snapshot, or Q&A thread. Configuration and quota
failures are surfaced as source-specific errors so the user can correct them.

The transport keeps a provider lease for the request and the provider's gap
after it completes. arXiv is limited to one connection and a three-second
provider gap; the other adapters use their own conservative gaps. A local
single-process deployment can coordinate in memory. Hosted and multi-instance
deployments use the existing `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` pair. If a hosted deployment cannot reach the
shared store, specialized source execution fails closed with a coordination
error instead of treating per-instance throttles as a global limit. See
[environment variables](environment-variables.md#shared-stores).

## Steer the frontier during exploration

During the queued and exploration phases, the node inspector exposes **same
level first**, **same level later**, and **restore default**. The plan area
exposes **Add research question**. A new question is attached to an existing
plan step and becomes a new root node for that step. The host trims and checks
the question, deduplicates it against existing queries, and enforces the
existing node and command limits.

The UI writes a durable `ResearchSteeringCommand`; it does not mutate the run
directly. The command carries a task ID, run ID, sequence, stable node intent or
stable new-node ID, absolute priority, and pending/applied/rejected status. The
execution owner holds `research-execution:<taskId>` through the run and consumes
queued commands only after the current wave and checkpoint have been committed,
before evaluating whether to stop. Core run data is saved before the command is
acknowledged, so a crash can safely replay an absolute command without creating
another completed node.

Steering requires durable core and extension storage plus the browser Web Lock.
Another tab may submit a command but cannot apply it. If those capabilities are
unavailable, the rest of Research continues and steering is disabled. Commands
for already scheduled nodes, closed runs, verification, synthesis, terminal
states, missing steps, duplicates, or exhausted limits are rejected with a
specific reason. A late command is therefore visible as rejected rather than
silently changing a completed wave.

An accepted added question prevents a soft early-stop until its node has been
attempted, when budget permits. Hard budgets, cancellation, errors, and other
terminal rules still take precedence, and unanswered additions are listed as
report gaps. Source expansion follows the existing authorized snapshot flow;
semantic scope expansion still pauses for plan approval. Refreshing the page
does not resume execution automatically.

## Plan with only the context that is needed

Planning first uses model knowledge with all tools disabled. Only an unfamiliar
research object or concept triggers selected knowledge lookup, then public search
if needed. Evidence collection, freshness checks, and full-source reads follow
plan approval. Knowledge and public lookups each allow two queries and five
results per query; public queries are fixed before private knowledge is read.
The disclosure distinguishes skipped lookups and knowledge queries from public
queries. Lookup failures do not prevent an assumption-based plan.

## Search requests and recoverable evidence

Research searches in one browser tab share a FIFO queue, with one request in
flight and at least two seconds between request start times. Both search tool
names and batch subqueries use this queue. A duplicate query is shown as skipped
without another network request. Batch failures retain successful query results;
a batch fails as a whole only when all queries fail.

The planning web stage has a fixed 90-second total deadline, including model
waiting and queueing; selected knowledge lookup retains its 30-second deadline.
Execution requests also obey the remaining task budget. Research Tavily requests
use a 90-second timeout and the optional `research_summary` profile: advanced
search with summaries and image descriptions, without raw page content.
Page bodies are obtained through the separate read tools. Pause or cancellation
aborts queue waits and active requests.

HTTP 429 starts a queue cooldown from `Retry-After`, or 60 seconds when that
header is absent. Neither 429 nor 504 immediately replays a search. Errors retain
the service status and distinguish an upstream failure, a local response timeout,
and an authentication dependency failure. The existing single BYOK decryption
recovery remains separate from upstream retries. The queue does not coordinate
other tabs or devices; deployment gateways may impose a shorter wall-clock limit.

Evidence metadata supplies the same source identity and content hash to the
ledger and source callback. Repeated reads can participate in a round without
increasing its new-source count. A batch page read reports all-failed outcomes
explicitly and keeps successful reads when other URLs fail.

Archiving uses a frozen projection of committed source bodies and aliases, shared
with its one tool-free repair. Excerpts are bounded to 8,000 characters per tool
and 48,000 overall, and further reduced to fit the model context. Model knowledge
and internal tool-result files do not become formal evidence.

Research read results over 8,000 characters are stored locally before commitment.
Checkpoints retain complete, redacted result envelopes or registered references,
so cache hashes remain valid on resume. Recovery reads complete JSON, up to the
existing 5 MiB file limit. Tool-result paths must belong to the session and match
an exact committed reference and its content hash. Missing, changed, or invalid
files become explicit body gaps; archive recovery does not fetch them again from
the network. Legacy checkpoints that omitted bodies remain limited to whatever
committed material can actually be recovered.

The reconnaissance `timeoutMs` validator now accepts values through 90,000;
existing 30,000 values remain valid. **Rollback requires a compatible reader**:
older builds whose validator caps this field at 30,000 reject new 90-second
records. No historical reports or tasks are rewritten.

## Read a report with explicit limitations

A report is delivered even when coverage, verification, or sources are incomplete.
Source-backed findings, unverified material, and model knowledge are labelled;
model knowledge is not added to the evidence ledger. Quality notices and gaps
stay in the exported Markdown. Both complete and partial reports appear in chat
and the workbench. A non-user generation interruption preserves available text;
if the model supplied none, the fallback lists existing findings and unanswered
plan questions. Pause and cancellation still stop the workflow.

The plan's coverage progressbar is removed. Research rounds, real activity states,
and the existing controls describe progress without a constantly changing
coverage/depth strip. A failed activity does not acquire a running spinner simply
because it is the latest entry.

Standard report headings and built-in fallback explanations support English,
Chinese, and Japanese. Chapter recognition uses language-independent identities;
code blocks, custom chapters, references, and footnotes remain intact. Existing
reports receive a read-only heading projection without rewriting their Artifacts
or evidence snapshots.

The **Report** tab shows the main text and its concise limitations notice.
**Supplementary material** contains sources, knowledge supplementation, evidence
gaps, unverified material, pending questions, and coverage/quality/version details.
The **Activity** tab contains the run overview and detailed usage. All report
views and questions follow the selected version. The download menu exports a
complete Markdown or PDF document, including appendices and quality notices.

Click a document title or preview to open its existing reader; Research documents
open the report page. Links, download controls, keyboard actions, and text
selection retain their own behavior. Streaming documents cannot be opened until
streaming ends; interrupted partial documents remain readable.

## Ask questions about a report

The Research workbench's **Questions** tab supports multiple named topics. Each
topic is bound to one exact report version. Publication attempts to save a
`ResearchEvidenceSnapshot` of the final Markdown, evidence, citation mapping,
gaps, and claim ledger before publishing the report pointer. If that auxiliary
save fails, the report remains readable and exportable; only that version's
Questions feature is unavailable. Core report or Artifact persistence errors
remain real save failures. Updating the task cannot change a saved snapshot.

All new report versions record `evidenceSnapshotStatus` as `available` or
`unavailable`. A missing or invalid snapshot for either kind of new version is
never reconstructed from later evidence. Only legacy versions without this field
retain restricted reconstruction from their own run relationships. The core
schema also accepts skipped reconnaissance and optional knowledge lookup records.
Old records need no rewrite, but rolling back to a build with the earlier strict
schema requires compatible readers first; do not open new records with a reader
that rejects these fields or enum values.

Select a report version, create or rename a topic, and ask a question. Each
topic stores its own turns and can be deleted independently. A request includes
the task ID, report version ID, and topic ID. The model receives only the frozen
report, evidence, claims, and completed question/answer pairs from that topic.
Tools, network access, Memory, and Research startup are disabled. Previous
answers are conversation context but never new evidence. The host keeps whole
completed turns within a bounded history, streams the answer, and allows one
active generation per topic with cancellation and retry of the last failed turn.

Every completed answer is checked against the snapshot's canonical source
locators and source/claim labels. An invalid citation fails the turn and is not
added to future history. If the frozen material is insufficient, the answer is
instructed to say so. Selecting an older report version changes the request's
snapshot and topic list; a late response from another version cannot be applied
to it. A completed or partially completed report can be queried. For old reports
created before snapshots existed, the app reconstructs a restricted snapshot
from that report's own run relationships and labels it as reconstructed; it
does not fall back to the task's latest evidence.

Answer generation requires the topic lock and durable extension storage. If the
browser cannot provide exclusive locking, the answer control is disabled. A
task deletion cancels active answers and removes its sidecar records. Session
copies remap snapshot, topic, turn, request, and evidence IDs; an in-flight turn
in a copy is marked interrupted and is never replayed. Orphan records are
removed during Research storage cleanup. These records remain local in
`neo-chat-research-extensions` v1 and are not included in ZIP export or synced
across devices by this feature.

Cleanup rechecks published report IDs under the task lock before removing an
unpublished snapshot. Automatic global OPFS orphan sweeping is suspended:
another tab may be writing a report or checkpoint that has no core pointer yet.
Explicit task deletion still releases report files after checking references.

## Trust and operational limits

Research remains read-only with respect to external sources. Source content is
untrusted input; only the host can authorize tools, commit evidence, or publish
a report. Templates and Q&A history do not add permissions. Use the report's
coverage, evidence gaps, source coverage notes, and stop reason when a provider
returns only metadata or an unavailable abstract/full text.

For provider references and usage policies, consult the official [arXiv API
manual](https://info.arxiv.org/help/api/user-manual.html), [arXiv terms of
use](https://info.arxiv.org/help/api/tou.html), [NCBI E-utilities
documentation](https://dataguide.nlm.nih.gov/eutilities/utilities.html),
[EPO OPS documentation](https://developers.epo.org/), and [SEC EDGAR access
guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data).

## Image materials

Research preserves normalized search images and available source-page URLs in
an illustration catalog, separate from the formal evidence ledger. The catalog
is checkpointed and each report version retains the images available to its
synthesis pass. Older saved tasks without a catalog continue to load normally.

The synthesis prompt encourages relevant images from that catalog, with captions
and available provenance. It does not require a quota, invent image URLs, or
claim to have visually examined an image. Image discovery does not raise claim
verification, evidence counts or source-body usage. A report still completes
when no suitable images are available or an image cannot be displayed.

Report illustrations use standalone Markdown image syntax, `![description](url)`,
with available source links. They are not wrapped in blockquotes or HTML image
tags. The workbench and Markdown/PDF exports do not add a separate image-materials
gallery or appendix. Inline images retain previews and source links.

Chat's default system instructions apply the same Markdown-image guidance when
an illustration helps the answer and its real URL is available in the conversation
or tool results. Report readers, exports and read-only conversation shares preserve
the applicable report version rather than consulting a later run's image catalog.
Existing report Markdown and share snapshots are not rewritten.
