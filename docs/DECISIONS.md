# Architecture decisions

This file records decisions and deviations from the original local-only, Ollama-based specification.

## D-001: Gemini replaces Ollama

**Decision:** Use the Google Gemini API through the official `google-genai` Python SDK for chat, streaming, thinking summaries, structured extraction, and embeddings.

**Reason:** The user selected Gemini and the build machine has no Ollama installation. Gemini keeps the app usable on a low-memory machine while providing current streaming and reasoning features.

**Consequences:** Live mode requires `GEMINI_API_KEY` and internet access. Mock mode remains mandatory and fully functional without a key. Prompt and memory content is sent to Google only in live mode.

## D-002: `generateContent` instead of the Interactions API

**Decision:** Use the stateless `generateContent` / `streamGenerateContent` path behind an `LLMProvider` interface.

**Reason:** BranchMind owns and reconstructs all history locally. The stateless path gives exact control over visibility, provider parts, thought signatures, and persistence. The Interactions API can be added later behind the same interface.

## D-003: Thinking level replaces temperature

**Decision:** Remove temperature from branch settings and store `thinking_level` (`low`, `medium`, `high`).

**Reason:** Current Gemini 3.6+ models ignore `temperature`, `top_p`, and `top_k`. The memory `top_k` setting remains because it controls retrieval, not the model.

## D-004: Authentication is required

**Decision:** Email/password accounts with Argon2id hashing and opaque session cookies. Every space belongs to one user. Cross-user objects return 404.

**Reason:** The user requested authentication. Per-user ownership is the only safe multi-account model.

**Consequences:** There is no email verification, password-reset email, or OAuth. The app is still local-only and binds to loopback.

## D-005: Anchor commits

**Decision:** Every branch is created with a hidden `anchor` commit. A fork anchor's parent is the fork commit. The branch head starts at the anchor.

**Reason:** This guarantees a non-null head and a real source commit for manually added memories before the first chat message. Anchors are excluded from UI messages and model context.

## D-006: Normalized memory overrides

**Decision:** Store one override row per `(branch_id, memory_id)` with nullable `excluded`, `pinned`, and `content_override`.

**Reason:** The original multi-row action primary key made override ordering ambiguous. One row is deterministic and easier to update.

## D-007: Fork preview at the fork commit

**Decision:** Fork preview and fork memory decisions use effective memories at the selected fork commit, not the source branch's current head.

**Reason:** Otherwise memories created after the fork point would leak into the child, violating upstream-only visibility.

## D-008: Windows-first tooling

**Decision:** Primary scripts are `run.ps1` and `run.cmd`. `run.sh` is optional for Unix-like shells. Use `py -3.12` for the backend venv.

**Reason:** Development happens on Windows PowerShell.

## D-009: Tailwind CSS v4

**Decision:** Use Tailwind v4 with the Vite plugin and CSS variables instead of a legacy `tailwind.config.js`.

**Reason:** This is the current Tailwind setup and keeps design tokens in one CSS place.

## D-010: Local fonts

**Decision:** Bundle Inter, Source Serif 4, and JetBrains Mono through `@fontsource-variable` packages.

**Reason:** The UI must work without external font CDNs.

## D-011: Profile storage

**Decision:** `spaces.profile_json` is the canonical personalization profile and is included directly in the system prompt. It is shown as a dedicated Personalization section, not duplicated as a memory row. Manually added `kind=profile` memories remain supported.

**Reason:** Avoids two sources of truth and duplicate context text.

## D-012: Provider parts and thought signatures

**Decision:** Persist Gemini model parts and thought signatures on assistant commits. If replaying a signature fails, retry once without signatures and record the fallback in the trace.

**Reason:** Gemini 3/4 models may require signatures for reasoning continuity, while branch history is reconstructed manually.

## D-013: Mock mode is a first-class provider

**Decision:** The mock provider returns deterministic embeddings and rule-based extraction candidates so auth, branching, memory proposals, and the full UI can be tested without a key.

**Reason:** Tests and demos must not depend on external quotas.

## D-014: Transient `streaming` commit status

**Decision:** Assistant commits are inserted with `status=streaming` before the provider call and finalized as `complete`, `partial`, or `error`. The transient value is never used in a final trace.

**Reason:** The UI and API need to distinguish an in-flight reply from an interrupted one. A placeholder row also guarantees a stable assistant commit id for partial persistence and SSE error reporting.

## D-015: Two-phase assistant trace around memory extraction

**Decision:** Persist the assistant reply, generated trace, and final status before extraction starts. Extraction then appends its step, operations, and warnings to the trace. The `done` SSE event is emitted after extraction so clients receive proposals first.

**Reason:** A provider extraction failure must never roll back or fail the assistant reply. Persisting first keeps the reply durable even if the client disconnects during extraction, while the late trace update preserves a complete Why view.

## D-016: Explicit fork commit and no message duplication

**Decision:** `POST /branches/{id}/fork` accepts an optional `commit_id`. The service validates the commit is visible, creates a new anchor whose parent is that commit, copies branch settings and only writes the requested `exclude`/`pin` overrides. No messages or memories are duplicated.

**Reason:** The UI must be able to fork from any visible message, not only the source head, while keeping the child isolated and making inherited memory choices reviewable.

**Consequences:** Fork preview is computed at the same commit. Memory choices are rejected if they are not effective at that point.

## D-017: Merge and sync copy only memories

**Decision:** Merge candidates are source-effective memories whose source commits are not visible in the ancestor target. Sync candidates are direct-parent effective memories whose source commits are not visible in the child. Both operations copy selected memories only, create one visible `merge` or `sync` commit to anchor the copies, and never copy raw messages. Duplicate detection uses normalized exact text and cosine `> 0.92`.

**Reason:** This preserves the Git-like promise: raw conversation history stays on its branch, while explicit memory decisions move upward or are pulled down.

**Consequences:** Every copied memory records `derived_from_id`, its new origin branch, and the merge/sync commit as its source. A merge with nothing new and no summary is rejected.

## D-018: Portable space exports with ID remapping

**Decision:** Export a versioned JSON document containing space metadata, branches, commits, memories, overrides, proposals, and checkpoints. Embeddings are base64 encoded. Import validates graph references, remaps every entity ID into a new space owned by the current user, and commits atomically with deferred foreign-key checks.

**Reason:** Export/import must roundtrip a space without copying owner identity, IDs, or rows across users.

**Consequences:** Imported trace JSON is preserved as-is and may contain old IDs; it is display history, not a relational reference. A merge commit may retain the ID of a source branch that was later deleted; import clears that dangling provenance rather than rejecting the space. Invalid or cyclic graph payloads return 422.

## D-019: Merge summaries degrade locally

**Decision:** `POST /branches/{id}/merge-summary` returns a deterministic local summary in mock mode. In live mode it asks Gemini for strict JSON, but falls back to the local summary with a warning if the provider fails or returns unusable output.

**Reason:** Summary generation is a convenience and must never block an upward merge.

**Consequences:** The response labels `mock`, `provider`, and any fallback warning.

## D-020: Zustand-driven navigation and responsive shell

**Decision:** The frontend uses Zustand stores and localStorage instead of a routing dependency. The selected space and branch persist under `branchmind:space` and `branchmind:branch`. The sidebar becomes a drawer below 900px and the inspector becomes a drawer below 1280px.

**Reason:** The app has one authenticated workspace surface and the build specification does not include a router. This keeps navigation small and makes the active branch available to every panel without URL synchronization.

**Consequences:** There are no shareable deep links yet. Workspace requests carry a generation guard so a logout or user switch cannot apply responses from the previous session.

## D-021: Theme persistence without a flash

**Decision:** Store `light`, `dark`, or `system` under `branchmind-theme`, apply it through `data-theme`, and run a small inline script before React loads. The UI listens for `prefers-color-scheme` changes while the preference is `system`.

**Reason:** A manual toggle must coexist with the OS preference and a dark page must not flash light while the bundle starts.

**Consequences:** CSS tokens remain the single source of colors. The toggle and synchronized `theme-color` metadata follow system changes without a reload.

## D-022: One API client and a reusable SSE reader

**Decision:** All JSON calls go through `src/api/client.ts`, which includes credentials, parses the stable error envelope, and adds `X-BranchMind-Request: 1` to mutations. Streaming calls use `src/api/sse.ts`, which parses named SSE events, comments, multi-line data, CRLF, and trailing blocks.

**Reason:** Authentication failures and mapped backend errors should render consistently, while Phase 7 chat needs one tested parser rather than a second ad hoc implementation.

**Consequences:** Provider failures before the first token surface as `ApiError`. Provider failures after streaming starts remain `error` SSE events handled by the chat caller.

## D-023: Export/import is exposed in Phase 6 settings

**Decision:** The Data settings tab uses the Phase 5 export/import endpoints immediately. Embedding rebuild stays visible but disabled until its endpoint exists.

**Reason:** Export/import is already part of the backend contract and completes the settings surface without implying an unimplemented action works.

**Consequences:** Imported spaces become owned by the current user and appear in the space picker after the import response. The UI reports the imported branch, message, and memory counts from the backend.

## D-024: Compact trace summaries travel with messages

**Decision:** `GET /branches/{id}/messages` includes a `trace_summary` for messages with stored traces: provider, mock flag, duration, retrieved-memory count, thinking source and summary, usage, and status. The full ranked trace remains lazy-loaded from the trace endpoint.

**Reason:** The reasoning pill and inherited replies need duration and memory counts without issuing one extra request per assistant message. Embedding the full trace would inflate the transcript payload and duplicate the Why API.

**Consequences:** The summary is derived from the persisted trace each time messages are listed. Full score breakdowns, considered memories, operations, and warnings still come from the trace endpoint when the inspector opens.

## D-025: Streamed chat is optimistic and rAF-batched

**Decision:** Sending a message appends an optimistic user turn, sends the current `expected_head_id`, and streams into a separate live reply. Tokens are buffered and applied once per animation frame. On completion or interruption, the transcript is refetched, the live reply is cleared, and the branch counts refresh.

**Reason:** Optimistic feedback keeps the composer responsive, head checking prevents silently forking on a stale view, and animation-frame batching avoids a render for every token. Refetching after the stream reconciles persisted ids and statuses rather than trusting temporary ids.

**Consequences:** The Stop action aborts the request, waits briefly for the backend to persist the partial reply, then reloads the transcript. Manual scrolling disables auto-follow until the user returns to the bottom.

## D-026: Trace selection is shared through a small store

**Decision:** Message actions write a `{branchId, commitId}` target to a trace store and switch the inspector to Why. The Inspector tab itself moved into the UI store, while trace contents are fetched by the Why panel.

**Reason:** The chat and inspector are separate layout branches, so a local callback would need prop plumbing through the shell. A two-field store keeps the cross-panel action explicit and resets cleanly when the branch changes.

**Consequences:** Switching branches clears the selected trace and returns the inspector to Memory. The Why panel remains empty until an assistant reply is selected.

## D-027: Forks can unpin inherited memories

**Decision:** `POST /branches/{id}/fork` accepts `unpin_memory_ids` in addition to `exclude_memory_ids` and `pin_memory_ids`. The fork dialog tracks which preview memories were already pinned and sends a branch-local `pinned=0` override when the user unpins one.

**Reason:** Pinning is inherited through the branch lineage. Without an explicit unpin choice, turning off a pin in the fork checklist would look successful while the child stayed pinned, breaking the promise that the checklist controls the child's memory behavior.

**Consequences:** The three lists must be disjoint and must reference memories available at the fork commit; contradictory choices return 422 `invalid_memory_choice`. Excluded memories need no unpin override, and inherited upstream rows are never mutated.

## D-028: Branch operations are globally mounted dialogs

**Decision:** Fork, merge, sync, and rename state lives in a small operations store, and `OperationDialogs` mounts the active dialog at the app shell level. Fork and merge previews load on demand; merge and sync submit the expected target head.

**Reason:** Branch actions come from the sidebar, branch header, messages, checkpoints, and the sync banner. A global dialog host avoids duplicating modal state across those surfaces while keeping stale-view conflicts explicit.

**Consequences:** Checkpoint forks reuse the generic fork dialog at the checkpoint commit instead of a separate flow. The merge dialog targets ancestors only, and a successful merge bumps a sync revision so the current child rechecks for newly merged upstream memories.

## D-029: Archiving is reversible and the root is protected

**Decision:** Archive is a PATCH on the existing `archived` flag. Archived branches remain in the sidebar and memory inspector, reject chat and memory mutations with 409 `branch_archived`, and cannot merge or sync. The root branch returns 409 `root_branch_protected` instead of being archived.

**Reason:** Archiving should hide a branch from active work without destroying its history. Removing the root would leave a space with no canonical lineage, so it is never archivable.

**Consequences:** Forking an archived branch remains allowed for inspection and replay. The UI immediate archive action is reversible from the same menu; Settings uses an inline confirmation and still offers restore.

## D-030: The memory inspector is the single control surface

**Decision:** The Memory inspector loads the effective and excluded sets plus pending proposals, filters them locally by text and kind, and performs all edits through the existing memory and proposal routes. Inherited memories expose branch-local pin, content edit, exclude, and restore actions; only own memories can be deleted. A conflicting proposal offers explicit `Replace old` and `Keep both` choices.

**Reason:** Phase 9 needs memory control without expanding the API surface or duplicating the effective-memory algorithm in the browser. Grouping the already-computed effective list keeps ownership and inheritance rules on the server.

**Consequences:** Inherited edits change content only; kind and importance remain upstream values. Archived branches render the same evidence read-only. The panel reloads when the branch message or memory count changes, so proposals extracted after a reply appear without a manual refresh.

## D-031: Personalization uses a small known profile vocabulary

**Decision:** The profile editor exposes `about`, `tone`, `language`, and `expertise` while preserving unknown profile keys. Branch Settings edits persona, system prompt, thinking level, retrieval strength, and memory mode; it shows the space-default model instead of offering an invalid model chooser.

**Reason:** The backend accepts arbitrary profile JSON, but the context composer and UI need stable labels for the common fields. Restricting model editing to the configured allowlist prevents avoidable 422 errors while keeping advanced prompt control available.

**Consequences:** Clearing a known profile field removes it; clearing all optional fields is allowed. The editor remounts when the space or branch changes instead of synchronizing state in an effect. Profile changes apply to the next reply across the space, while branch voice changes stay on that branch.

## D-032: Provenance jumps are ephemeral browser state

**Decision:** Source links write a `focusedCommitId` to the UI store. The branch view scrolls the matching `data-commit-id`, applies a short highlight, and clears the focus after 1.6 seconds. A source that is not a rendered message produces an explanatory toast. On narrow screens the inspector drawer closes so the highlighted message is visible. The Why panel also shows the retrieval query and always renders a `What changed in memory` section, including an explicit no-change state.

**Reason:** Provenance should be immediate without new API calls, routes, or persisted navigation state. Keep-origin-meaning visible is more useful than showing a stale inspector over the target message.

**Consequences:** Source jumps do not survive reloads and anchor, merge, sync, or checkpoint commits have no message to focus. The Why panel remains a complete explanation even when extraction made no memory change.

## D-033: Phase 10 navigation is global and graph-aware

**Decision:** The command palette and global shortcuts live in the app shell and share the UI store with the inspector. The branch graph loads from one space-level endpoint and keeps fork, merge, sync, and checkpoint data in a single response. Compare is an ancestor-only dialog opened from the branch view, branch menu, or palette.

**Reason:** Phase 10 actions are reachable from several surfaces, so local component state would duplicate modal hosting and keyboard handling. One graph payload avoids repeated branch-by-branch requests while the response remains small enough for a local SQLite-backed app.

**Consequences:** The graph endpoint omits edges to deleted branches, while archived branches remain visible. Switching branches preserves an open Graph or Settings inspector tab; only Why resets to Memory. Compare is hidden for root branches because there is no ancestor to compare against.

## D-034: Large lists rely on browser containment before virtualization

**Decision:** Static transcript rows and memory cards opt into `content-visibility: auto` with estimated intrinsic sizes. `MessageItem` and `MarkdownMessage` are memoized, and message action callbacks are stable so a streaming token or a single edited row does not reparse the entire transcript.

**Reason:** The acceptance target is 500 messages and 200 memories, where off-screen markdown parsing dominates rendering more than the remaining DOM size. Browser containment keeps keyboard navigation and find-in-page behavior intact, unlike an early windowing layer that would add scroll-anchor complexity.

**Consequences:** Rows use estimated heights until painted, so extremely tall messages can adjust scroll height as they enter the viewport. The memoization test updates one row in a 500-message list and asserts that only that row re-renders; virtualization remains a later option if measured scrolling still misses the target.

## D-035: The demo space is seeded per user and never fakes Gemini

**Decision:** `POST /api/demo-space` builds a fresh owned space with a main branch, two forks at different baselines, one upward merge, one checkpoint, one pending proposal, pinned and excluded inherited memories, and stored assistant traces. The traces use `provider: "demo"`, `thinking_source: "synthetic_context"`, and an explicit seeded-transcript summary. Embeddings are generated through the active provider; if the call fails, the demo still loads with missing-embedding warnings. The empty workspace and Settings > Data both expose the action.

**Reason:** A new account needs an immediately inspectable example of branching, memory selection, merge, sync pressure, and the Why view without requiring a live model key or copying content from another user. Labelling the traces prevents a seeded transcript from being mistaken for model reasoning.

**Consequences:** Demo creation is idempotent only in the sense that it always creates a new space, never a shared one. Loading it during live Gemini mode may take one embedding round-trip; loading it in mock mode is fully local. The demo is ordinary mutable data, so the user can chat, fork, merge, or delete it like any other space.

## D-036: Test suite consolidation and unified root scripts

**Decision:** Centralize all scattered frontend tests into a dedicated `frontend/src/test/` directory, mirroring the backend's clean separation in `backend/tests/`. Keep production source directories (`components/`, `api/`, `lib/`, `store/`) focused purely on application logic. Add a root `package.json` proxying standard commands (`dev`, `build`, `test`, `lint`) across frontend and backend.

**Reason:** Having test files co-located inside dozens of nested UI component and feature folders creates clutter and makes production packaging less organized. Centralizing tests into `frontend/src/test/` with updated imports cleans up the production tree while ensuring Vitest and TypeScript continue to validate all 14 test suites and 38 test cases seamlessly.

**Consequences:** Moving tests required updating relative import paths for components and store modules. Production code is now free of test clutter. Developers can run `npm run dev`, `npm test`, `npm run build`, and `npm run lint` directly from the repository root or within the `frontend/` directory.

## D-037: PostgreSQL (NeonDB) dual-mode and Qdrant vector database support

**Decision:** Support both PostgreSQL (NeonDB) in production via `DATABASE_URL` and SQLite for local development/testing. Support Qdrant Cloud or local container via `QDRANT_URL` and `QDRANT_API_KEY`, using a Two-Phase ID-filtered vector retrieval pattern that resolves commit DAG visibility in SQL before querying vector similarity in Qdrant.

**Reason:** Production scalability benefits from serverless PostgreSQL on NeonDB without idle sleep timeouts that break apps, and offloads vector index compute to Qdrant. Preserving SQLite and in-memory cosine fallback allows existing test suites and offline local workflows to remain instant and fully operational.

**Consequences:** Added `psycopg` (v3) and `qdrant-client` to requirements. Schema DDL is maintained for both SQLite (`schema.sql`) and PostgreSQL (`schema_pg.sql`). Parameter binding transparently bridges `?` and `%s`.

## D-038: Independent frontend (Vercel) and backend (Render / Railway) deployment architecture

**Decision:** Structure deployment manifests so frontend and backend can be hosted on different platforms (Frontend on Vercel, Backend on Render or Railway). Configure `frontend/vercel.json` with reverse proxy rewrites (`/api/:path*`) to the backend, enabling first-party cookie behavior without cross-origin tracking blocks. Add `backend/render.yaml`, `backend/Procfile`, and `backend/railway.json`.

**Reason:** Modern single-page applications frequently deploy static assets to edge CDNs (Vercel) and long-running SSE servers to container runtimes (Render/Railway). Vercel rewrites avoid CORS preflight latency on chat streams and keep session cookies on the same domain.

**Consequences:** CORS middleware is configured to allow custom production domains when direct cross-origin calls are used. The app can be deployed together or completely independently.


