# ChartHub

ChartHub treats conversations like Git repositories: a **Space** is the repository, a **Branch** is an isolated conversational timeline, and **Memories** are versioned, inherited, selectable, and mergeable.

The authoritative build contract lives in [AGENTS.md](AGENTS.md). Architecture decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

---

## Tech Stack & Production Architecture

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Backend** | Python 3.12, FastAPI, Uvicorn | Native Server-Sent Events (SSE) streaming, async endpoints, Render & Railway ready |
| **Database** | PostgreSQL (NeonDB) / SQLite | Dual-mode: Production serverless PostgreSQL with NeonDB (`DATABASE_URL`), zero-setup local SQLite fallback |
| **Vector Engine** | Qdrant / Local NumPy Cosine | Dual-mode: Dedicated Qdrant vector database (`QdrantClient`) with two-phase ancestor isolation, zero-setup local fallback |
| **AI / Embeddings** | Google Gemini (`google-genai` SDK) | `gemini-3.8-flash` with thinking levels, `gemini-embedding-001` (768-dim) |
| **Local Fallback** | Deterministic Mock Provider | Streamed canned replies, hash embeddings, synthetic context summaries |
| **Auth** | Argon2id (`argon2-cffi`) | HttpOnly, SameSite=Lax session cookies, cryptographic token hashing |
| **Frontend** | Vite, React 19, TypeScript | Strict typing, responsive drawer layout, dark/light themes, Vercel ready |
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

---

## Production Deployment Guide

ChartHub is fully engineered for split-architecture production deployment:
* **Frontend:** Deployed to **Vercel** as a high-performance static SPA with automated API rewrites.
* **Backend:** Deployed to **Render** or **Railway** as a containerized FastAPI service.
* **Database:** Serverless **PostgreSQL** hosted on **NeonDB** (zero-sleep architecture).
* **Vector Engine:** Cloud-managed **Qdrant** (or local vector fallback).

```
   ┌────────────────────────────────────────────────────────┐
   │                   Frontend (Vercel)                    │
   │   SPA UI + vercel.json reverse proxy to /api/*         │
   └───────────┬────────────────────────────────────────────┘
               │
               ▼ HTTPS (First-Party Cookies preserved)
   ┌────────────────────────────────────────────────────────┐
   │             Backend (Render / Railway)                 │
   │       FastAPI + Uvicorn Async Server                   │
   │  (schema_pg.sql auto-migrated on first boot)           │
   └───┬────────────────────────────────────────────────┬───┘
       │                                                │
       ▼ Connection Pool                                ▼ REST / gRPC
 ┌──────────────┐                                ┌──────────────┐
 │ NeonDB (PG)  │                                │ Qdrant Cloud │
 │ Relational DB│                                │ Vector DB    │
 └──────────────┘                                └──────────────┘
```

### 1. Database Setup (NeonDB PostgreSQL)
1. Sign up at [neon.tech](https://neon.tech) and create a free PostgreSQL project.
2. Under "Connection details", copy the pooled connection string, e.g.:
   ```
   postgresql://user:password@ep-sample-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
3. Set `DATABASE_URL` in your backend environment variables. The backend automatically boots with `schema_pg.sql` and creates all tables, foreign keys, and indexes.

### 2. Vector DB Setup (Qdrant)
1. Sign up at [qdrant.tech](https://cloud.qdrant.io) and create a free 1GB cluster.
2. Note your Cluster URL (e.g., `https://xxxx.cloud.qdrant.io:6333`) and generate an API key.
3. Set `QDRANT_URL` and `QDRANT_API_KEY` in your backend environment variables.
*(Note: If omitted, ChartHub falls back seamlessly to internal NumPy cosine similarity.)*

### 3. Deploy Backend to Render or Railway

#### Option A: Render
1. Connect your Git repository to [render.com](https://render.com).
2. Select **Web Service**, set Root Directory to `backend` (or use the included `backend/render.yaml` Blueprint).
3. Set Build Command: `pip install -r requirements.txt`
4. Set Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Configure Environment Variables in Render Dashboard:
   - `APP_HOST`: `0.0.0.0`
   - `DATABASE_URL`: Your NeonDB PostgreSQL connection string
   - `QDRANT_URL`: Your Qdrant cluster endpoint
   - `QDRANT_API_KEY`: Your Qdrant API key
   - `GEMINI_API_KEY`: Your Google Gemini API key
   - `ALLOWED_ORIGINS`: Your Vercel frontend URL (e.g., `https://chathub.vercel.app`)
   - `COOKIE_SECURE`: `true`
   - `ALLOW_SIGNUP`: `true`

#### Option B: Railway
1. Create a new project on [railway.app](https://railway.app) from your GitHub repo.
2. Set Root Directory to `/backend` (Railway detects `backend/Procfile` and `backend/railway.json`).
3. Add the same Environment Variables listed above.

### 4. Deploy Frontend to Vercel
1. Import your Git repository into [vercel.com](https://vercel.com).
2. Set **Root Directory** to `frontend`.
3. Framework Preset: **Vite**.
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Add Environment Variable:
   - `VITE_API_URL`: Your deployed backend URL (e.g., `https://chathub-backend.onrender.com`)
7. Click **Deploy**. The included `frontend/vercel.json` automatically proxies `/api/*` to `VITE_API_URL`, ensuring authentication cookies and SSE streams pass without third-party cookie restrictions.

---

## Renaming the Base Directory to "ChartHub" on Windows

Because Windows locks active working directories when command prompts or IDEs have handles open, follow these quick steps:

1. Close any running dev servers (`Ctrl+C`).
2. Close the current terminal or switch to the parent directory:
   ```powershell
   cd ..
   Rename-Item -Path "New folder" -NewName "ChartHub"
   cd ChartHub
   ```
3. Open the newly renamed `ChartHub` directory in your editor or terminal. All configurations, Git history, and dependencies remain completely intact.
