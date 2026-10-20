# BranchMind

BranchMind treats a conversation like a Git repository: a **Space** is the repository, a **Branch** is a chat thread, and **Memories** are versioned, inherited, and mergeable.

The authoritative build contract lives in [AGENTS.md](AGENTS.md). Architecture decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

---

## Tech Stack

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Backend** | Python 3.12, FastAPI, Uvicorn | Native Server-Sent Events (SSE) streaming, async endpoints |
| **Database** | SQLite via standard library `sqlite3` | WAL mode, foreign keys, ACID transactions, `PRAGMA busy_timeout=5000` |
| **AI / Embeddings** | Google Gemini (`google-genai` SDK) | `gemini-3.8-flash` with thinking levels, `gemini-embedding-001` (768-dim) |
| **Local Fallback** | Deterministic Mock Provider | Streamed canned replies, hash embeddings, synthetic context summaries |
| **Auth** | Argon2id (`argon2-cffi`) | HttpOnly, SameSite=Lax session cookies, cryptographic token hashing |
| **Frontend** | Vite, React 19, TypeScript | Strict typing, responsive drawer layout, dark/light themes |
| **Styling** | Tailwind CSS v4 + CSS variables | Self-hosted `@fontsource-variable` (Inter, Source Serif 4, JetBrains Mono) |
| **Interactive Graph**| `@xyflow/react` (React Flow) | Lazy-loaded DAG branch visualizer with commit and sync markers |
| **Markdown** | `react-markdown`, `remark-gfm`, `rehype-highlight` | Syntax-highlighted code blocks, tables, math, safe rendering |

---

## Quick Start & Simple Commands

### 1. Run Everything (One Command)
Runs both the FastAPI backend (`http://127.0.0.1:8000`) and the React UI (`http://127.0.0.1:5173`) with health-checking:

* **PowerShell:**
  ```powershell
  ./run.ps1
  ```
* **Command Prompt:**
  ```cmd
  run.cmd
  ```
* **npm (from root):**
  ```powershell
  npm run dev:all
  ```

### 2. Run Frontend Only
```powershell
npm run dev
# or: cd frontend && npm run dev
```

### 3. Run Backend Only
```powershell
backend/.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir backend
```

### 4. Build for Production
Compiles TypeScript and creates optimized production assets:
```powershell
npm run build
```

### 5. Run All Tests
Executes both frontend Vitest and backend Pytest test suites:
```powershell
npm test
# Or run individually:
npm run test:frontend
npm run test:backend
```

### 6. Lint & Format
```powershell
npm run lint
```

---

## Organized Project Layout

All test suites are cleanly decoupled into dedicated test folders so production directories stay clean and maintainable:

```
branchmind/
├── AGENTS.md                  # Comprehensive engineering contract
├── README.md                  # Complete documentation and user guide
├── package.json               # Root convenience runner (dev, build, test, lint)
├── run.ps1 / run.cmd / run.sh # Unified startup scripts
├── .env.example               # Configuration template
├── docs/
│   └── DECISIONS.md           # Architecture Decision Records (ADRs)
├── backend/
│   ├── requirements.txt       # Python dependencies
│   ├── app/                   # Clean production source code
│   │   ├── main.py            # App factory, middleware, lifespans
│   │   ├── config.py          # Typed Pydantic settings
│   │   ├── db.py / schema.sql # SQLite initialization & schema
│   │   ├── visibility.py      # Core R1 ancestor commit & memory isolation
│   │   ├── auth/              # Passwords, session tokens, dependencies
│   │   ├── repo/              # Users, spaces, branches, commits, memories
│   │   ├── llm/               # Gemini SDK provider & mock fallback
│   │   ├── engine/            # Context composer, retrieval, extraction, chat
│   │   ├── ops/               # Fork, merge, sync, diff, checkpoints, export
│   │   └── routes/            # Thin REST and SSE route handlers
│   └── tests/                 # All 71+ backend pytest suites (isolated)
└── frontend/
    ├── package.json           # Frontend dependencies & scripts
    ├── vite.config.ts         # Vite bundler & Vitest configuration
    └── src/
        ├── App.tsx            # Root component with auth & routing
        ├── api/               # Typed fetch client, SSE consumer, interfaces
        ├── auth/              # Auth store & session listener
        ├── components/        # Pure production UI components (no test clutter)
        │   ├── chat/          # Message items, markdown, streaming cursor
        │   ├── graph/         # React Flow interactive branch DAG
        │   ├── inspector/     # Memory manager, personalization, Why trace panel
        │   ├── layout/        # AppShell, sidebar, branch switcher, command palette
        │   └── operations/    # Fork dialog, upward merge dialog, sync dialog, diff
        ├── store/             # Zustand stores (workspace, ui, operations, trace)
        └── test/              # All 14 consolidated frontend Vitest suites
```

---

## Core Product Concepts & Features

### 1. User & Space Isolation
* **Strict Ownership (`spaces.owner_id`)**: Every space belongs to exactly one authenticated user.
* **Invisible Objects Return 404**: Foreign spaces, branches, or commits never return 403; unauthorized entities appear non-existent.
* **Secure Cookies**: Opaque tokens stored with `HttpOnly`, `SameSite=Lax`, and Argon2id hashing.

### 2. Git-like Branching & Visibility (The R1 Rule)
* **Upstream-Only Visibility**: A branch can see only its own commits/memories plus ancestors up to the exact fork point. Siblings, cousins, children, or subsequent upstream commits are completely invisible.
* **Anchor Commits**: Every branch begins with a hidden anchor commit, ensuring non-null head commit references and real commit IDs for memories.
* **Parent Commit Walk**: The `visible_commit_ids` function computes visibility by traversing `commits.parent_id` upward to the root.

### 3. Version-Controlled Memory Universe
* **Provenance**: Every memory records its `origin_branch_id` and `source_commit_id`.
* **Branch-Local Overrides**: Inherited memories can be **excluded**, **pinned**, or have their content **overridden** on a branch without mutating upstream data.
* **Supersedes Pointers**: Memory updates set `supersedes_id` so outdated memories are cleanly masked within visible lineage.
* **Review / Auto / Off Modes**:
  * `review`: AI-extracted memories appear as pending proposals with conflict detection.
  * `auto`: Non-conflicting memories are stored automatically; conflicts await review.
  * `off`: Memory extraction is skipped.

### 4. Transparent Retrieval & Reasoning (The "Why" View)
* **Hybrid Scoring**:
  $$\text{Score} = 0.60 \times \text{CosineSimilarity} + 0.25 \times \text{Importance} + 0.15 \times \text{RecencyDecay}$$
* **Inspectable Trace**: Every assistant turn records a full trace JSON showing:
  * Selected memories with score breakdowns.
  * Considered-but-skipped memories (budget limits, low score, stale embeddings).
  * Excluded memories and branch overrides.
  * Exact context token composition and Gemini usage metadata.
  * Real model thinking or clearly labelled synthetic context summaries.

### 5. Git Operations
* **Fork from Anywhere**: Fork from any visible message, checkpoint, or branch head. Includes a 3-step memory checklist (keep, exclude, pin, unpin).
* **Upward-Only Merge**: Merge selected memories and an AI-generated summary into an ancestor branch. Messages are never copied.
* **Sync Upstream**: Pull new memories created on a parent branch after the fork point.
* **Compare Divergence**: Diff memory sets and message history between any branch and its ancestors.
* **Checkpoints**: Snapshot named points in a branch to preserve baselines or reopen as new branches.
* **Interactive Graph**: Interactive visual DAG displaying branches, fork points, merges, syncs, and checkpoints.
* **Command Palette**: Press `Ctrl+K` to switch branches, jump spaces, open diffs, or toggle settings.

---

## Verification & Test Status

All suites pass with 100% success rate:

* **Backend Tests (`pytest`):** 71 passed, 2 skipped (live-only tests).
* **Frontend Tests (`vitest`):** 14 test suites, 38 tests passed.
* **TypeScript Compilation (`tsc`):** Zero errors.
* **Vite Production Build:** Success.
* **Linters (`oxlint`, `ruff`):** Zero warnings, zero errors.
