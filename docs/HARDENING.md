# ChatHUB Hardening Playbook: Memory, Data and Security

A companion to the ChatHUB build script. It explains what teams usually miss before production, how ChatGPT and Claude handle memory, and exactly what to audit, fix and test.

**How to use:** Save as `docs/HARDENING.md`. Audit the existing code against every section, write failing tests first, then fix. Record every finding in `docs/AUDIT.md` as: `id`, `severity`, `what was wrong`, `fix`, `test name`, `status` (`fixed` or `deferred with reason`). Do not mark anything fixed without a passing test.

**Stack for this version:** Neon PostgreSQL is the system of record for messages, branches, memories, audit and jobs. Qdrant stores only vectors plus a few filter fields. Postgres is always the authority: nothing returned by Qdrant is trusted until Postgres confirms it. This replaces every SQLite and local-vector mention in the build script and in the sections below (with dual-mode fallback retained for zero-setup local dev/offline testing).

---

## Part A. Report: What Teams Usually Miss

| # | Risk | Why it bites | Fix lives in |
| :--- | :--- | :--- | :--- |
| **1** | **Localhost is not safe by default.** Any website visited can send requests to `localhost:8000` (CSRF, DNS rebinding, wildcard CORS). | A malicious page can read or delete memories. | Part F, item 1 |
| **2** | **Memory poisoning.** Text from a web page, file, or tool result gets saved as a memory and later steers the model like an instruction. | Persistent prompt injection that survives across chats and branches. | Part F, item 2 |
| **3** | **Cross-branch leaks through forgotten code paths** (SQL search, Qdrant queries, export, traces, counts, autocomplete). | Breaks the core promise of conversational and memory isolation. | Part C.8, D, and F |
| **4** | **Delete does not really delete.** Memory text also lives in Postgres history (Neon restore window), Qdrant vectors and snapshots, full-text index, trace jsonb, merge copies, exports, and dumps. | Privacy and governance failure. | Part G |
| **5** | **Memory rot.** Old facts never expire, contradictions pile up, retrieval returns stale or conflicting items. | Answers get worse over time. | Part C |
| **6** | **Concurrency bugs.** Two tabs, double submit, stream cut mid-write, crash during merge. | Corrupt tree or half-merged state. | Part C.6 |
| **7** | **Sensitive data stored silently** (health, finances, secrets, third parties). | Trust and legal risk. | Part F, item 7 |
| **8** | **Model changes break embeddings.** A new embedding model makes old vectors meaningless. | Retrieval silently degrades. | Part C.6 and C.8 |
| **9** | **No evals.** Nobody measures recall, leakage or contradiction handling. | Regressions go unnoticed. | Part H |
| **10**| **Unbounded everything.** Message size, memory count, branch depth, tokens, request rate. | Crashes and cost blowups. | Part F, item 8 |
| **11**| **Hallucinated memory.** The model claims to remember things that are not stored. | Users lose trust. | Part C.4 |
| **12**| **Sharing leaks upstream.** Sharing a child branch exposes inherited private memories. | Privacy failure. | Part E |
| **13**| **Postgres and Qdrant drift apart.** A memory is saved but never indexed, or deleted in Postgres but still searchable in Qdrant. | Missing recall, or deleted data resurfacing. | Part C.8 |
| **14**| **Neon and Qdrant operations.** Pooled vs direct connections, cold starts after idle, leaked connection strings, a publicly exposed Qdrant port. | Outages and data exposure. | Part C.6 and L |

---

## Part B. How ChatGPT and Claude Manage Memory

Based on public help pages and secondary write-ups as of October 2026.

### ChatGPT (OpenAI)
- **Two layers:**
  1. *Saved memories:* Explicit details the user asked it to remember, kept as a separate, editable list apart from chat history.
  2. *Reference chat history:* Insights gathered automatically from past chats, which is a synthesized profile and not an auditable list.
- **Independent switches** for each layer, with the rule that turning off saved memories also turns off history referencing.
- **Retrieval, not full recall:** Relevant saved items and summaries are pulled into context per message (RAG), so older or minor details may stop surfacing.
- **Temporary Chat** reads no memory and writes none.
- **Deleting a chat does not delete memories created in it.** Users must delete the memory itself (and the chat, to fully erase).
- **Project-only memory option:** A project uses only its own chats and ignores outside memories, with nothing leaking out.
- **Evolution:** Newer systems refresh and synthesize memory between sessions, with regional differences (default off in EEA/UK).
- **Feedback hooks:** Users can mark a used memory as relevant or not, correct it, or ask not to mention it again.

### Claude (Anthropic)
- **Memory summary:** An editable, human-readable summary synthesized in the background from chat history (refreshing roughly daily) and loaded at the start of conversations.
- **Project-scoped memory:** Each project has its own isolated memory and summary, separate from non-project chats.
- **Incognito chats** are excluded from memory and from past-chat search.
- **User control:** View and edit the summary, tell Claude in chat what to remember or forget, pause memory (keeps summary, stops new entries), or reset/disable it.
- **Search past chats** as a separate retrieval tool.
- **Import and export** of memory for backup or migration.
- **Org controls and retention:** Admins can disable memory; retention policies apply to memory data.
- **Safety stance:** Designed for work contexts, steering away from sensitive topics.

### What to Incorporate into ChatHUB
1. Separate explicit memory (user-approved, auditable) from inferred profile (synthesized, labeled as inferred, easy to reset).
2. Scoped memory by default (ChatHUB branch isolation is stronger than both products).
3. A temporary/incognito branch that reads and writes nothing.
4. Pause, reset, export, import controls.
5. Retrieval with a budget instead of stuffing everything into the prompt.
6. A visible 'memory updated' notice with undo, and a 'why was this used' view.
7. Make deletion semantics explicit: deleting a branch asks whether to also delete the memories born there.

---

## Part C. Memory Architecture and Management

### C.1 Memory Tiers
| Tier | What | Storage | Lifetime | Written by |
| :--- | :--- | :--- | :--- | :--- |
| **Working** | Prompt actually sent to the model | In-memory only | One request | Context composer |
| **Short-term (episodic)** | Recent turns, rolling summary of older turns, scratch notes | Postgres: `commits`, `branch_summaries` | Branch life, compacted | Chat engine, summarizer job |
| **Long-term semantic** | Durable facts, preferences, decisions, tasks | Postgres `memories` (text, metadata, audit) + vector in Qdrant | Until superseded, expired, or deleted | Extraction pipeline with user approval |
| **Profile & procedural** | Name, tone, persona, standing instructions | Postgres `memories` (`kind='profile'`, pinned) | Until edited | User only |
| **Archive** | Raw transcripts and traces | Postgres `commits`, `trace_json` (jsonb) | Retention policy | Chat engine |

*Only working memory goes to the model. Archive is searchable by the user but never auto-injected.*

### C.2 Memory Record & Schema Evolution
Postgres schema standards: UUIDv7 text/uuid IDs, `timestamptz` timestamps, `jsonb` for traces/profiles/usage, booleans for flags, and CHECK constraints for enums.
New columns on `memories`:
- `version`: int NOT NULL DEFAULT 1
- `status`: text CHECK (status IN ('candidate','active','stale','superseded','archived','tombstoned'))
- `confidence`: real (0 to 1)
- `source_type`: text (user_stated, inferred, imported, merged, synced)
- `sensitivity`: text (none, personal, sensitive)
- `subject_key`: normalized topic (e.g. `user.location`)
- `valid_from`, `valid_to`: timestamptz (null means current)
- `expires_at`, `last_used_at`: timestamptz
- `use_count`: integer DEFAULT 0
- `locked`: boolean DEFAULT false (user-locked, never auto-changed)
- `content_hash`: text
- `index_state`: text (pending, indexed, failed, deleted)
- `content_tsv`: tsvector generated full-text index

New tables:
- `memory_events`: Append-only audit log (id, memory_id, branch_id, actor, action, before_json, after_json, created_at).
- `memory_versions`: Previous content of each edit, for undo.
- `branch_summaries`: Rolling summary per branch with covered commit range and hash.
- `outbox_events`: Transactional outbox for Qdrant vector indexing and deletion.
- `jobs`: Background queue (type, payload, status, attempts, run_after, locked_at) with `FOR UPDATE SKIP LOCKED`.
- `idempotency_keys`: key (UNIQUE), route, response jsonb, created_at.
- `schema_migrations`: Applied migration IDs.

### C.3 Lifecycle State Machine
`candidate` $\to$ `active` $\to$ `stale` (inactivity/expiry) $\to$ `superseded` (newer fact for same `subject_key`) or `archived` $\to$ `tombstoned` $\to$ hard-deleted by `forget`.
Transitions must go through a single `MemoryService` that writes an audit row to `memory_events`.

### C.4 Write Path (How Memories Get Created)
1. Capture candidates from latest user message only. Assistant text, tool outputs, and web results must never create active memories directly (quarantine as candidate).
2. Classify: durable vs one-off, sensitive categories, third-party facts, secrets/ID numbers (reject), imperative instructions (standing instruction needing explicit consent).
3. Normalize: atomic fact, third-person, absolute dates, `subject_key`, quote evidence.
4. Deduplicate: content hash and cosine similarity (>0.90 dropped).
5. Conflict check: same `subject_key` or similarity 0.75–0.90. User-stated beats inferred.
6. Consent gate: `review` (default), `auto` (non-sensitive only), `off`.
7. Grounding rule: Model never says "I remember..." from memory hallucination; query DB instead.

### C.5 Read Path (How Memories Reach the Model)
1. Query formulation: User message + context rewrite.
2. Hybrid retrieval: Qdrant dense vector similarity + PostgreSQL `to_tsvector` FTS, merged via Reciprocal Rank Fusion (RRF).
3. Filter first: Ancestor visibility check (`visible_commit_ids`), active/stale status, unexpired, unexcluded, sensitivity gate.
4. Rerank: Similarity, importance, recency decay, use count damping, pinned/user_stated boost.
5. Diversity: Maximal Marginal Relevance (MMR).
6. Budget: Token cap, pinned profile preservation, stale flagging.
7. Safe composition: Delimited untrusted background data block; facts, never instructions.
8. Usage logging: Update `last_used_at`, `use_count`, trace metadata.

### C.6 Consistency, Concurrency, and Storage Safety
- Row-level or async locks per branch: One active generation per branch (409 on race).
- Idempotency keys on `/chat`, `/merge`, `/sync`, `/import`.
- Atomic operations: Single transaction for operations; head moves only after assistant commit is committed.
- Optimistic concurrency: `version` column on memories and branches (409 on version conflict).
- Embedding migration: Model change marks vectors stale; background worker re-embeds.

### C.7 Background Consolidation Jobs
- Rolling branch summarizer.
- Near-duplicate memory deduplication.
- Staleness sweep (`expires_at` or inactivity).
- Contradiction sweep (duplicate `subject_key`).
- Outbox processor for Qdrant synchronization.

---

## Part D. Branch Semantics and Edge Cases
1. Parent edits memory post-fork: Child keeps point-in-time view; Sync banner notifies user.
2. Parent deletes memory: Soft delete to tombstone; child shows "removed upstream" with "keep local copy".
3. Child override + parent supersede: Conflict card displayed in child memory panel.
4. Three-way merge conflicts: Base (at fork), source, target. Same `subject_key` with divergent values triggers conflict card.
5. Merge replays: Idempotent via `derived_from_id` and `content_hash`.
6. Ancestor check: Merge target must be strict ancestor.
7. Deleting branch with children: Archive or reparent, never orphan.
8. Lineage depth cap (e.g. 50) and LRU cache for `visible_commit_ids`.
9. Cross-space isolation: Every query scoped by `space_id` and `owner_id`; 404 for foreign IDs.
10. Temporary branches (`ephemeral=1`): No extraction, no long-term retrieval, excluded from search, purged on close.
11. Regenerate creates sibling branch.
12. Past message edit treated as fork from that message's parent.
13. Strict property-based test with Hypothesis verifying ancestor isolation.

---

## Part E. Sharing and Collaboration
- Snapshot sharing (not live mutable links).
- Flattened view: Shared child does not leak unshared ancestor messages/memories.
- Roles: Owner, editor, viewer.
- Unguessable tokens ($\ge 128$ bits), hashed at rest, revocable.
- Never mix private profile memory into shared snapshots.

---

## Part F. Threat Model and Exploit Edge Cases
1. **Localhost & API Protection:** Strict CORS, Host header validation, API session token, non-dev docs disabled.
2. **Memory Poisoning Defense:** Untrusted sources quarantined; instruction-like phrasing rejected.
3. **Data Exfiltration Defense:** No auto-loading remote images, link hover inspection, strict CSP (`img-src 'self' data:`).
4. **XSS & Injection:** Markdown sanitization, parameterized SQL only, escaped FTS.
5. **IDOR Prevention:** Scoped validation on every ID against active space and branch.
6. **Secrets & Sensitive Data:** Secret detection (regex + entropy), sensitive topics gated.
7. **Resource Abuse:** Message size caps, memory limits, rate limits, pagination.
8. **Canary Leakage Verification:** Secret canary in sibling branch must never leak into responses, traces, or exports.

---

## Part G. Data Lifecycle and Governance
- Per-space retention settings.
- True `forget` operation: Single transaction removes memory row, versions, Qdrant vectors, FTS tokens, trace JSON matches, and proposals.
- Space export to JSON and Markdown; safe validated import.
- Centralized memory management screen (all memories, search, audit, forget).

---

## Part H. Quality, Evals, and Observability
- Automated test evals: Recall, update/supersede, canary leakage, forget completeness, injection resistance, staleness decay.
- Chaos tests: Mid-operation terminations.
- Local metrics dashboard: Retrieval latency, proposal accept rate, duplicate rate.

---

## Part I. UX Safeguards
- "Memory updated" toast with Undo.
- Review inbox for candidates, conflicts, and stale memories.
- Composer indicator: "Using N memories" with "Answer without memory" toggle.
- Temporary branch button in header.
- Provenance and confidence badges on memory cards.

---

## Part J. Agent Execution Plan
- **H0:** Audit codebase against all sections, write failing tests, document in `docs/AUDIT.md`.
- **H1:** Migration framework and schema v2 (Postgres NeonDB authority, SQLite fallback).
- **H2:** `MemoryService` and centralized lifecycle management.
- **H3:** Hardened write path pipeline (classifiers, secrets, poison quarantine).
- **H4:** Hardened read path (hybrid RRF search, MMR diversity, canary isolation).
- **H5:** Concurrency, locks, idempotency, outbox vector sync.
- **H6:** Branch edge cases (tombstones, three-way merge, ephemeral branches).
- **H7:** Security hardening (CORS, Host header, CSP, secrets scanner, rate limits).
- **H8:** Background consolidation jobs and review inbox.
- **H9:** Snapshot sharing safeguards.
- **H10:** Governance UI, export/import, and true forget.
- **H11:** Final evaluation gate and audit report.
