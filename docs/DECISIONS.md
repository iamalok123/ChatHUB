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
