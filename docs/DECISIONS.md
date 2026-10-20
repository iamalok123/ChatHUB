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
