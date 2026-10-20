# BranchMind: Agent Build Script

Git for chatbot memory. A local-only app where conversations are branches, memory is version-controlled, and the user can see exactly why the AI answered the way it did.

**How to use:** create an empty folder, save this document there as `AGENTS.md`, open OpenCode in that folder and send: `Read AGENTS.md fully, then execute it phase by phase. Do not stop until Section 12 passes.`

---

## 0. Your role and operating rules

You are a senior full-stack engineer agent. Build BranchMind end to end on this machine.

1. Work through the phases in Section 11 in order. After each phase: run its verify steps, fix failures, run `git add -A && git commit -m 'phase N: summary'`, then print a 5-line status (done, verified, assumptions, risks, next).
2. Do not ask questions unless truly blocked. Pick the simplest option and record the choice in `docs/DECISIONS.md`.
3. Localhost only. Bind to `127.0.0.1`. No cloud services, no auth, no Docker, no deploy config, no telemetry, no paid APIs.
4. Simplest tech wins. Do not add a dependency that is not listed in Section 3 unless you record why in `docs/DECISIONS.md`.
5. The app must never be left broken. After every phase `./run.sh` must start both servers and the UI must load.
6. If a tool or model is missing, install it or use the documented fallback instead of stopping.
7. Write typed, small, readable files. Comment only the non-obvious parts.
8. Before declaring any phase done, actually run the code or tests. Never claim something works without executing it.

---

## 1. Product concept

BranchMind is GitHub for chats. Each Space is like a repository. Conversations are branches. Memories are versioned, inherited, selectable and mergeable.

| Git concept | BranchMind concept |
| --- | --- |
| Repository | **Space**: a project or persona with its own memory universe |
| Commit | **Message node**: one user or assistant turn, linked to its parent |
| Branch | **Branch**: a chat thread with its own settings |
| Fork | **Fork from any message**, choosing which memories carry over |
| Merge | **Merge up**: send selected memories plus a summary to an upstream branch |
| Pull | **Sync upstream**: pull newly created parent memories into a branch |
| Diff | **Compare**: memory and conversation divergence between a branch and an ancestor |
| Tag | **Checkpoint**: a named snapshot of a point in a branch |
| Blame | **Provenance**: which message and branch created each memory |

The three things the user must feel:

1. **Memory control:** see, edit, pin, exclude and merge memories per branch.
2. **Personalization:** the AI adapts through a profile, per-branch persona and remembered preferences.
3. **Reasoning transparency:** every answer has a 'Why this answer' view showing retrieved memories, context used, model thinking and memory changes.

---

## 2. Non-negotiable rules

- **R1 Upstream-only visibility.** A branch can see only its own messages and memories plus those of its ancestors up to each fork point. Never siblings, cousins, children, or ancestor content created after the fork point. Enforce it in ONE function (`visible_commit_ids`) that every query goes through.
- **R2 Memory is explicit.** Every memory has provenance (source message, origin branch) and a status. Nothing is invisible to the user.
- **R3 Fork means choose.** Forking opens a checklist of inherited memories. Default is keep all. The choice is stored as overrides on the new branch.
- **R4 Merge goes only upward** to an ancestor branch. Raw messages are never copied. Only user-selected memories and an optional summary are merged.
- **R5 Always show why.** Every assistant reply stores a trace the UI can display.
- **R6 Deletion safety.** A branch can only edit or delete memories it owns. Inherited memories can only be excluded, pinned or overridden on that branch, never changed upstream.

---

## 3. Tech stack (all local)

| Layer | Choice | Why |
| --- | --- | --- |
| Backend | Python 3.11+, FastAPI, Uvicorn | Fast to write, native SSE streaming |
| DB | SQLite via stdlib `sqlite3` (WAL mode) | Zero setup, one file |
| Vectors | Embeddings stored as float32 BLOB, cosine with NumPy | No vector DB needed at this scale |
| LLM | **Ollama** at `http://127.0.0.1:11434` | Free, local, supports streaming |
| Chat model | `llama3.2:3b` default (configurable). Optional `qwen3:8b` if the machine has 16GB RAM, since it emits thinking | Small and fast |
| Embedding model | `nomic-embed-text` via Ollama | Small and good |
| HTTP client | `httpx` | Streaming support |
| Frontend | Vite + React + TypeScript | Simple and fast |
| Styling | Tailwind CSS + CSS variables for themes | Sleek UI quickly |
| State | Zustand | Tiny |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight` | Chat rendering |
| Graph | `@xyflow/react` (React Flow) | Branch DAG view |
| Icons | `lucide-react` | Clean icons |
| Tests | `pytest` (backend), `vitest` (small frontend checks) | Standard |

**Fallbacks:** if Ollama or the models are unavailable, enable `LLM_MODE=mock`. The mock returns a canned streamed reply, a fake thinking block and a hash-based pseudo-embedding, so the whole UI and branching logic is testable without a model. Add an optional `LLM_MODE=anthropic` or `openai` adapter behind the same interface only as a stretch goal.

---

## 4. Environment setup (Phase 0 does this)

Check and install what is missing:

```bash
python3 --version   # need 3.11+
node --version      # need 20+
ollama --version    # install from https://ollama.com if missing
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

Create `.env.example` and copy to `.env`:

```
LLM_MODE=ollama
OLLAMA_URL=http://127.0.0.1:11434
CHAT_MODEL=llama3.2:3b
EMBED_MODEL=nomic-embed-text
DB_PATH=./data/branchmind.db
BACKEND_PORT=8000
FRONTEND_PORT=5173
```

---

## 5. Repository layout

```
branchmind/
  AGENTS.md  README.md  run.sh  .env.example  .gitignore
  docs/DECISIONS.md
  backend/
    requirements.txt
    app/
      main.py            # FastAPI app, CORS for localhost:5173 only
      config.py  db.py  schema.sql
      models.py          # Pydantic schemas
      visibility.py      # THE isolation logic
      repo/              # spaces.py branches.py commits.py memories.py
      llm/               # base.py ollama.py mock.py embeddings.py
      engine/            # context.py retrieval.py extraction.py chat.py
      ops/               # fork.py merge.py sync.py diff.py checkpoints.py
      routes/            # spaces.py branches.py chat.py memories.py ops.py
      seed.py
    tests/
  frontend/
    src/ (api/ store/ components/ pages/ lib/ styles/)
```

---

## 6. Data model (`schema.sql`)

```sql
CREATE TABLE spaces(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
  profile_json TEXT DEFAULT '{}', created_at TEXT NOT NULL);

CREATE TABLE branches(
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, name TEXT NOT NULL,
  parent_branch_id TEXT, fork_commit_id TEXT, head_commit_id TEXT,
  system_prompt TEXT DEFAULT '', persona TEXT DEFAULT '',
  model TEXT, temperature REAL DEFAULT 0.7, top_k INTEGER DEFAULT 6,
  memory_mode TEXT DEFAULT 'review',   -- review | auto | off
  color TEXT, archived INTEGER DEFAULT 0, created_at TEXT NOT NULL);

CREATE TABLE commits(
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  parent_id TEXT,                       -- previous message; first message of a fork points at fork_commit
  role TEXT NOT NULL,                   -- user | assistant | system | merge | summary
  content TEXT NOT NULL, thinking TEXT, trace_json TEXT,
  merge_source_branch_id TEXT, created_at TEXT NOT NULL);

CREATE TABLE memories(
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL,
  origin_branch_id TEXT NOT NULL, source_commit_id TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT DEFAULT 'fact',             -- fact | preference | decision | profile | summary | task
  importance REAL DEFAULT 0.5, embedding BLOB,
  supersedes_id TEXT, derived_from_id TEXT,   -- derived_from_id set when copied by merge or sync
  created_at TEXT NOT NULL);

CREATE TABLE memory_overrides(
  branch_id TEXT NOT NULL, memory_id TEXT NOT NULL,
  action TEXT NOT NULL,                 -- exclude | include | pin | unpin | edit
  new_content TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY(branch_id, memory_id, action));

CREATE TABLE memory_proposals(
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, commit_id TEXT NOT NULL,
  content TEXT NOT NULL, kind TEXT, importance REAL,
  conflicts_with_memory_id TEXT, reason TEXT,
  status TEXT DEFAULT 'pending',        -- pending | accepted | rejected
  created_at TEXT NOT NULL);

CREATE TABLE checkpoints(
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, commit_id TEXT NOT NULL,
  name TEXT NOT NULL, created_at TEXT NOT NULL);
```

Use UUID4 or ULID strings for ids. Add indexes on `commits(parent_id)`, `commits(branch_id)`, `memories(source_commit_id)`, `memories(space_id)`.

---

## 7. Core algorithms (implement exactly)

### 7.1 Visibility (the isolation guarantee)

Commits form a tree through `parent_id`. The first message in a forked branch has `parent_id = fork_commit_id`.

```
visible_commit_ids(branch):
    ids = []
    cur = branch.head_commit_id
    while cur: ids.append(cur); cur = commits[cur].parent_id
    return set(ids)
```

Because the walk follows parents from the branch head, it automatically includes upstream history up to the fork point and excludes siblings, children and later parent messages. **Every message or memory query must filter through this set.** Add a repository-level guard so that routes cannot fetch a commit or memory outside the active branch's visible set (return 404, not 403).

### 7.2 Memory visibility

A memory is visible to a branch if and only if `memory.source_commit_id in visible_commit_ids(branch)`. Memories created by manual add, merge or sync set `source_commit_id` to the target branch's head at that moment, so one rule covers everything.

### 7.3 Effective memory set

```
effective_memories(branch):
    vis = visible_commit_ids(branch)
    mems = memories where source_commit_id in vis
    drop any memory that is supersedes_id-target of another visible memory
    lineage = [root_branch, ..., branch]          # walk parent_branch_id then reverse
    for b in lineage:                              # closer branches override earlier
        apply overrides of b: exclude -> remove, include -> re-add, pin -> pinned=true,
                              unpin -> pinned=false, edit -> replace content
    return mems with flags: inherited (origin != branch), pinned, edited
```

### 7.4 Fork

Input: source branch, fork commit (must be in the source's visible set), new name, optional persona, and the memory decisions (lists of exclude ids and pin ids). Steps: create branch with `parent_branch_id`, `fork_commit_id`, `head_commit_id = fork_commit_id`; copy settings from source (overridable); write overrides for excluded and pinned memories. Nothing is duplicated; inheritance is by reference.

### 7.5 Merge up

Input: source branch, target branch (must be an ancestor of source), selected memory ids (only memories owned or visible in source and not already visible in target), optional edited summary text. Steps: create a `merge` commit on the target branch (parent is target head, `merge_source_branch_id` set) with the summary as content; copy each selected memory into the target with a new id, `origin_branch_id = target`, `source_commit_id = merge commit`, and `derived_from_id` pointing to the original; skip near duplicates (cosine > 0.92). Return the list of created and skipped memories.

### 7.6 Sync upstream

List memories visible to the parent at its current head but not visible to the child (created after the fork). The user selects some; copy them into the child like a merge in the opposite direction, with `derived_from_id` set.

### 7.7 Retrieval

```
query_text = last user message + last assistant message (truncated)
q = embed(query_text)
for m in effective_memories: score = 0.60*cosine(q, m) + 0.25*importance + 0.15*recency_decay(m.created_at)
pinned memories are always included
select top_k (branch.top_k) by score with min score 0.25, within a memory token budget of 800 tokens
return each memory with score parts and a reason string such as 'pinned', 'high similarity 0.81', 'preference'
```

Also return the memories that were considered but not selected, with their scores, for the inspector.

### 7.8 Context composition

System prompt = global app instructions + space profile + branch `system_prompt` + branch `persona` + a `Known memories` block listing selected memories as short bullets + an instruction to use memories naturally and never invent ones. Then the visible conversation (oldest first) trimmed to a 3000 token budget by dropping the oldest turns. Record counts and token estimates in the trace.

### 7.9 Memory extraction (after each assistant reply)

Call the chat model once with a strict instruction to return only a list of durable memories (facts about the user, preferences, decisions, tasks) from the latest user message and reply, each with kind and importance 0 to 1. Parse robustly: find the first JSON array, tolerate code fences, return an empty list on failure. For each candidate: embed it; if cosine above 0.90 with an effective memory, drop it as a duplicate; if between 0.75 and 0.90 and same kind, mark it as a conflict or update with `conflicts_with_memory_id`. Then by `memory_mode`: `review` stores proposals for the user to accept or reject, `auto` inserts accepted memories directly (conflicts still become proposals), `off` skips extraction. Accepting a conflict proposal offers 'replace old' (sets `supersedes_id`) or 'keep both'.

---

## 8. API spec (all under `/api`)

- `GET/POST /spaces`, `GET/PATCH/DELETE /spaces/{id}`
- `GET /spaces/{id}/branches` (tree with parent links, message counts, memory counts)
- `POST /branches` (create root branch), `PATCH /branches/{id}` (rename, settings), `DELETE /branches/{id}` (only if no children, otherwise archive)
- `GET /branches/{id}/messages` (visible chain only, each tagged with its source branch)
- `POST /branches/{id}/chat` : body has message text; returns an SSE stream (see Section 9)
- `POST /branches/{id}/regenerate/{commit_id}` : creates a sibling branch from the parent of that message
- `GET /branches/{id}/memories` : effective set with flags (inherited, pinned, edited, origin branch, provenance)
- `POST /branches/{id}/memories` (manual add), `PATCH /memories/{id}` (own only), `DELETE /memories/{id}` (own only)
- `POST /branches/{id}/memories/{memory_id}/override` : action exclude, include, pin, unpin, edit
- `GET /branches/{id}/proposals`, `POST /proposals/{id}/accept`, `POST /proposals/{id}/reject`
- `POST /branches/{id}/fork` (Section 7.4), `GET /branches/{id}/fork-preview?commit_id=` (memories that would be inherited)
- `GET /branches/{id}/merge-preview?target=` and `POST /branches/{id}/merge`
- `GET /branches/{id}/sync-preview` and `POST /branches/{id}/sync`
- `GET /branches/{id}/diff?against={ancestor_id}` : memories added, excluded, edited, and message counts since fork
- `GET/POST /branches/{id}/checkpoints`, `POST /checkpoints/{id}/fork`
- `GET /messages/{commit_id}/trace` : the stored reasoning trace
- `GET /spaces/{id}/export` and `POST /spaces/import` (JSON)
- `GET /health` : reports DB status, Ollama reachability and model availability

Every route that takes a `branch_id` plus another id must verify the other id is inside the branch's visible set.

---

## 9. Streaming and reasoning transparency

`POST /branches/{id}/chat` streams Server-Sent Events:

1. `step` events, one per stage, each with a name, status and small payload: `retrieve` (memories found and scores), `compose` (token counts, memory count, messages kept and dropped), `generate` (started), `extract` (candidates found).
2. `thinking` events with chunks of reasoning. If the model returns thinking natively, forward it. Otherwise parse `<think>...</think>` blocks from the stream. If the model gives none, send a short generated 'plan' line built from the trace (never fabricate model thoughts; label it 'Context summary').
3. `token` events with answer text chunks.
4. `proposals` event with the memory proposals or auto-saved memories.
5. `done` event with the new user and assistant commit ids.

Store the final trace in `commits.trace_json` on the assistant message: retrieved memories with score breakdown, excluded and low-scoring candidates, context sizes, model and settings, thinking text, memory operations.

---

## 10. UI specification (sleek like claude.ai, original design)

### 10.1 Design tokens (CSS variables, light and dark)

Light: bg `#FAF9F5`, surface `#FFFFFF`, sidebar `#F3F1EA`, border `#E8E6DC`, text `#1F1E1D`, muted `#6B6A65`, accent `#C96442`. Dark: bg `#262624`, surface `#30302E`, sidebar `#1F1E1D`, border `#3D3D3A`, text `#ECEAE3`, muted `#A09E96`, accent `#D97757`. Fonts: Inter for UI, a serif such as Source Serif 4 for assistant prose (optional toggle), JetBrains Mono for code. Radius 12 to 16px, subtle shadows, 150ms ease transitions, no heavy borders. Respect `prefers-color-scheme` with a manual toggle. Generate a distinct soft color per branch for chips and graph lanes.

### 10.2 Layout

- **Left sidebar (280px, collapsible):** space switcher, search, branch tree (indented, colored dots, hover actions: rename, fork, archive), 'New space' button, theme toggle, settings.
- **Center:** top bar with breadcrumb of lineage (`main > pricing-idea > cheaper-variant`), branch badge, Fork and Merge buttons. Messages in a centered 720px column. Composer is a rounded card with auto-growing textarea, send button, memory-mode chip and a memory counter (for example '12 memories active').
- **Right inspector (360px, collapsible) with tabs:** Memory, Why, Graph, Branch settings.

### 10.3 Messages

User messages in a soft bubble, assistant messages as clean prose with markdown, code blocks with copy button, a blinking caret while streaming. Messages inherited from upstream get a thin left rule in the origin branch color and a small 'from main' label so the user can see what came from upstream. Hover actions: copy, **Fork from here**, **Regenerate as new branch**, **Save as memory**, **Why this answer**. Above each assistant answer, a collapsed 'Reasoned for 2.1s, used 4 memories' pill that expands into the live steps (retrieve, compose, generate) and thinking text.

### 10.4 Memory panel

Groups: **Pending proposals** (accept, edit, reject, conflict banner with 'replace old' or 'keep both'), **Own**, **Inherited** (read-only text with exclude and pin toggles), **Excluded** (restorable). Each card shows content, kind chip, importance dot, pinned icon, provenance chip ('from main, message 7') and a click-through to jump to the source message. Search, filter by kind, 'Add memory' field. A Personalization section at the top edits the space profile (name, about me, preferences, tone) which is stored as pinned `profile` memories, plus branch persona, system prompt, temperature, `top_k` ('memory strength' slider) and memory mode (review, auto, off).

### 10.5 Why tab

For the selected assistant message: ranked list of retrieved memories with a score bar and breakdown (similarity, importance, recency), considered-but-skipped memories, pinned ones flagged, context composition bar (system, memories, history, current), thinking text, and a 'what changed in memory' list. A 'Replay without memory X' button is a stretch goal.

### 10.6 Fork dialog (3 steps)

1. Name the branch, optional goal or persona note, fork point shown with a message preview.
2. **Memory checklist** of every inherited memory with a toggle (keep or exclude), a pin option, search, bulk 'keep all', 'keep none', 'keep pinned only', and a live count. Show which memories would be retrieved by the first message as hints.
3. Confirm summary ('Keeping 9 of 14 memories, 2 pinned') and create. Then switch to the new branch.

### 10.7 Merge dialog

Target selector listing only ancestors. A checklist of memories new in this branch (not already in the target), editable summary text with a 'Generate summary' button using the model, a duplicate warning per item, and a clear note 'Messages are not copied'. Result toast with counts.

### 10.8 Other views and interactions

- **Graph tab and full-screen view:** React Flow DAG of branches with fork points, merge edges, checkpoint flags. Click a node to jump to the branch and message.
- **Compare view:** side by side current branch vs an ancestor, with memories added, excluded and edited, plus message count since fork.
- **Sync banner:** when the parent has new memories since the fork, show a subtle banner 'Upstream has 3 new memories' opening the sync dialog.
- **Command palette** (Cmd/Ctrl+K): switch branch, new branch, fork, merge, search memories, toggle theme.
- Shortcuts: Cmd+Enter send, Cmd+B sidebar, Cmd+. inspector.
- Empty states, skeleton loaders, error toasts, a banner when Ollama is down ('Running in mock mode').
- Accessible: focus rings, aria labels, keyboard navigable dialogs, responsive down to 900px.

---

## 11. Phased execution plan

For every phase: **Goal**, **Tasks**, **How**, **Done when**. Commit at the end of each.

### Phase 0: Bootstrap and environment

**Goal:** a clean project and working tools. **Tasks:** check Python, Node, Ollama; pull the two models; create the folder layout, `.gitignore` (data/, .env, node\_modules, .venv), `git init`; create `docs/DECISIONS.md` and `.env`. **How:** run the commands in Section 4; create a Python venv in `backend/.venv`; `pip install fastapi uvicorn httpx numpy pydantic pytest python-dotenv`; scaffold the frontend with `npm create vite@latest frontend -- --template react-ts`, then install `tailwindcss zustand react-markdown remark-gfm rehype-highlight @xyflow/react lucide-react`. **Done when:** `uvicorn` and `npm run dev` both start; `ollama list` shows both models (or mock mode is documented).

### Phase 1: Database and visibility core

**Goal:** the isolation guarantee exists and is tested before anything else. **Tasks:** write `schema.sql`, `db.py` (connection helper, WAL, init on startup), repository functions, `visibility.py` with `visible_commit_ids`, `lineage`, `effective_memories`. **How:** implement Sections 6 and 7.1 to 7.3 literally. Write `tests/test_visibility.py`: build a tree main > A > A1, main > B; assert A1 sees main (to fork point), A and A1 only, never B; assert a main message added after A forked is invisible to A; assert a memory created in B is invisible to A1; assert exclude overrides on A do not leak to main or B. **Done when:** `pytest` passes with these isolation tests green.

### Phase 2: LLM layer

**Goal:** one interface for chat streaming and embeddings. **Tasks:** `llm/base.py` interface (`stream_chat`, `chat_json`, `embed`), `ollama.py` using `/api/chat` with streaming and `/api/embeddings`, `mock.py`, a `health` check, and thinking parsing for `<think>` tags. **How:** use `httpx.AsyncClient` streaming NDJSON lines. Choose the implementation from `LLM_MODE`. Embeddings are normalized float32 arrays packed with `numpy.tobytes()`. **Done when:** a small script streams a reply and returns an embedding in both ollama and mock modes; `GET /health` reports status.

### Phase 3: Chat engine and branching API

**Goal:** chat on a branch works with streaming. **Tasks:** Spaces and Branches CRUD routes, `GET messages`, the chat route with SSE, `engine/context.py`, saving user and assistant commits and moving `head_commit_id`. **How:** implement Sections 7.8 and 9; for now skip memory (empty list) but emit step events. **Done when:** with `curl -N` you can create a space and branch, chat twice, see streamed tokens and persisted messages.

### Phase 4: Memory engine

**Goal:** extraction, proposals, retrieval and overrides. **Tasks:** `retrieval.py`, `extraction.py`, memory and proposal routes, override route, manual add, ownership rules (R6), supersede logic, memory modes. **How:** implement Sections 7.7 and 7.9. Ensure retrieval only reads `effective_memories`. Store full trace in the assistant commit. **Done when:** telling the bot 'I prefer short answers and I live in Bhubaneswar' produces proposals; accepting one makes it retrieved in the next turn and shown in the trace; tests cover dedupe, conflict and ownership.

### Phase 5: Fork, merge, sync, diff, checkpoints

**Goal:** the Git-like operations. **Tasks:** `ops/` modules and routes for fork (with preview), merge (ancestor-only validation), sync, diff, checkpoints, regenerate-as-branch, export and import. **How:** implement Sections 7.4 to 7.6. Reject a merge target that is not an ancestor with a clear 400 error. **Done when:** tests prove: forking with excluded memories hides them on the child only; merge copies only selected memories and no messages; merging into a non-ancestor fails; sync pulls parent memories created after the fork; a sibling can never see merged-in memories unless it is a descendant of the target at a later point.

### Phase 6: Frontend foundation and design system

**Goal:** the shell looks like a polished product. **Tasks:** Tailwind config with the Section 10.1 tokens, theme toggle, three-column layout, API client with SSE helper (use `fetch` and a stream reader, since POST SSE is needed), Zustand stores (space, branches, messages, memory, ui), toast and dialog primitives. **How:** build small reusable components (Button, IconButton, Chip, Dialog, Tabs, Tooltip, Skeleton). Keep one source of truth for colors in CSS variables. **Done when:** the shell renders with a sidebar and empty states in both themes, and the API health banner works.

### Phase 7: Chat experience

**Goal:** a smooth Claude-like chat. **Tasks:** message list with markdown and code highlighting, streaming render, composer, message hover actions, reasoning pill with live steps and thinking, auto-scroll that respects manual scrolling, upstream-origin styling on inherited messages. **How:** implement Sections 10.2 and 10.3. Batch token updates with `requestAnimationFrame` to avoid re-render storms. **Done when:** you can chat in a branch, see steps and thinking live, and inherited messages show their origin.

### Phase 8: Branch tree, fork and merge UX

**Goal:** the signature workflow is delightful. **Tasks:** sidebar branch tree, breadcrumb, Fork dialog (3 steps), Merge dialog, Sync banner and dialog, checkpoint creation, rename and archive. **How:** implement Sections 10.6 and 10.7 using preview endpoints. Optimistic UI where safe, and always refetch the branch memory after operations. **Done when:** you can fork from a message, drop some memories, chat, then merge selected ones back and see them on the parent.

### Phase 9: Memory, personalization and Why panels

**Goal:** the three product promises are visible. **Tasks:** memory panel with groups, proposals, provenance jump, profile editor, branch settings, Why tab with score bars and context composition bar. **How:** implement Sections 10.4 and 10.5 from `/memories` and `/trace` data. Provenance chips link to the source message and scroll to it. **Done when:** a stranger can understand which memories shaped an answer and can change them in two clicks.

### Phase 10: Graph, compare, command palette and polish

**Goal:** power features and finish. **Tasks:** React Flow graph, compare view, command palette, shortcuts, empty and error states, loading skeletons, responsive tweaks, accessibility pass. **How:** compute graph nodes and edges from `/branches` and checkpoints. Performance check with a seeded space of 500 messages and 200 memories; UI must stay smooth. **Done when:** all Section 10.8 items work.

### Phase 11: Seed data, docs and run script

**Goal:** one command to run and a demo to explore. **Tasks:** `seed.py` creating a demo Space 'Startup Advisor' with `main`, two forks (one with some inherited memories excluded), one merged branch, a checkpoint and a pending proposal; `run.sh` that activates the venv, starts the backend on 127.0.0.1:8000 and the frontend on 127.0.0.1:5173, checks Ollama and falls back to mock mode with a clear message, and stops both on Ctrl+C; `README.md` with setup, architecture diagram (mermaid), isolation explanation and screenshots-list placeholder. **Done when:** a fresh clone plus `./run.sh` gives a working demo.

---

## 12. Final acceptance checklist (run and report pass or fail for each)

1. `pytest` passes, including all isolation tests.
2. In the UI, a branch cannot display or retrieve memories or messages from a sibling or child, verified manually with the demo data.
3. Fork dialog lets me keep or exclude each inherited memory, and the child's behavior matches.
4. Merge works only upward, copies only chosen memories, and never copies messages.
5. Each assistant message has a Why view with retrieved memories, scores, context sizes and thinking or context summary.
6. Memory proposals work in review, auto and off modes, with conflict handling.
7. Profile and persona changes visibly alter the next reply.
8. UI looks clean in light and dark, no layout jumps while streaming, keyboard shortcuts work.
9. App runs fully offline with Ollama, and in mock mode without it.
10. Nothing binds to a public interface, nothing is deployed, and no secrets are committed.

When finished, output: what was built, how to run it, known limitations, and a list of next improvements.

---

## 13. Stretch goals (only after Section 12 passes)

- 'Replay without memory X' to show how an answer changes
- Memory decay and automatic summarization of old branches
- Optional Anthropic or OpenAI adapter through the same LLM interface
- Branch-level tool use (web search, file notes)
- Import conversations from exported chat JSON
- Multi-user mode and auth, only if later deployed
