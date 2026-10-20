# ChatHUB

ChatHUB treats conversations like Git repositories: a **Space** is the repository, a **Branch** is an isolated conversational timeline, and **Memories** are versioned, inherited, selectable, and mergeable.

---

## 1. Tech Stack & Production Architecture

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Backend** | Python 3.12, FastAPI, Uvicorn | Native Server-Sent Events (SSE) streaming, async endpoints, Render & Railway ready |
| **Database** | PostgreSQL (Neon) / SQLite | Serverless PostgreSQL with Neon (`DATABASE_URL`), connection pooling, zero-setup local SQLite fallback |
| **Vector Engine** | Qdrant / Local NumPy Cosine | Dedicated Qdrant vector database (`QdrantClient`) with two-phase ancestor isolation, zero-setup local fallback |
| **AI / Embeddings** | Google Gemini (`google-genai` SDK) | `gemini-3.8-flash` with thinking levels, `gemini-embedding-001` (768-dim) |
| **Local Fallback** | Deterministic Mock Provider | Streamed canned replies, hash embeddings, synthetic context summaries |
| **Auth** | Argon2id (`argon2-cffi`) | HttpOnly, SameSite=Lax session cookies, cryptographic token hashing |
| **Frontend** | Vite, React 19, TypeScript | Strict typing, responsive drawer layout, dark/light themes, Vercel ready |
| **Styling** | Tailwind CSS v4 + CSS variables | Self-hosted `@fontsource-variable` (Inter, Source Serif 4, JetBrains Mono) |
| **Interactive Graph**| `@xyflow/react` (React Flow) | Lazy-loaded DAG branch visualizer with commit and sync markers |
| **Markdown** | `react-markdown`, `remark-gfm`, `rehype-highlight` | Syntax-highlighted code blocks, tables, math, safe rendering |

---

## 2. Quick Start & Developer Commands

ChatHUB frontend and backend are completely decoupled and run in separate terminals:

### 1. Run Backend (Terminal 1)

**One-Time Setup (First Run Only):**
```powershell
cd backend
py -3.12 -m venv .venv                         # Creates isolated Python 3.12 virtual environment
.venv\Scripts\pip install -r requirements.txt  # Installs FastAPI, Uvicorn, Gemini SDK, Psycopg, etc.
```

**Single Command to Start Backend (Daily Development):**
```powershell
cd backend
.venv\Scripts\uvicorn app.main:app --reload
```
*What this command does:*
- Starts the FastAPI application with auto-reload enabled for developer hot-reloading.
- Reads configuration and secrets strictly from `backend/.env`.
- Automatically initializes the database and applies all schema migrations against Neon PostgreSQL (or SQLite if offline).
- Binds to `http://127.0.0.1:8000` (Health check endpoint: `http://127.0.0.1:8000/api/health`).

### 2. Run Frontend (Terminal 2)

**One-Time Setup (First Run Only):**
```powershell
cd frontend
npm install                                    # Installs React 19, Vite, Tailwind CSS, etc.
```

**Single Command to Start Frontend:**
```powershell
cd frontend
npm run dev
```
Frontend UI will be live at `http://127.0.0.1:5173`.

### 3. Run Tests
- **Frontend Vitest Suites (38 tests):**
  ```powershell
  cd frontend
  npm test
  ```
- **Backend Pytest Suites (78+ tests):**
  ```powershell
  cd backend
  .venv\Scripts\pytest tests
  ```

### 4. Build for Production
```powershell
cd frontend
npm run build
```

### 5. Lint & Format
- **Frontend:** `cd frontend && npm run lint`
- **Backend:** `cd backend && .venv\Scripts\ruff check .`

---

## 3. Clean, Decoupled Project Layout

```
ChatHUB/
├── AGENTS.md                  # Comprehensive engineering contract
├── README.md                  # Unified documentation, architecture, audit & run guide
├── .gitignore                 # Strict ignores for credentials, databases, docs, and build artifacts
├── backend/                   # Standalone Python 3.12 FastAPI Service (Render / Railway)
│   ├── .env                   # Active backend configuration & secrets (git-ignored)
│   ├── .env.example           # Standalone backend environment template
│   ├── requirements.txt       # Python dependencies (FastAPI, psycopg, qdrant-client, google-genai)
│   ├── pyproject.toml         # Packaging & ruff configuration
│   ├── railway.json           # Railway platform blueprint (builder & startCommand)
│   ├── render.yaml            # Render platform blueprint
│   ├── app/                   # Clean production source code
│   │   ├── main.py            # App factory, middleware, lifespans
│   │   ├── config.py          # Typed settings loaded from backend/.env
│   │   ├── db.py / schema.sql # Dual-mode Neon PostgreSQL / SQLite fallback
│   │   ├── visibility.py      # Core R1 ancestor commit & memory isolation
│   │   ├── auth/              # Passwords, session tokens, dependencies
│   │   ├── repo/              # Users, spaces, branches, commits, memories
│   │   ├── llm/               # Gemini SDK provider & mock fallback
│   │   ├── engine/            # Context composer, retrieval, extraction, chat
│   │   ├── ops/               # Fork, merge, sync, diff, checkpoints, export
│   │   └── routes/            # Thin REST and SSE route handlers
│   └── tests/                 # All backend pytest test suites
└── frontend/                  # Standalone Vite + React 19 + TypeScript SPA (Vercel)
    ├── .env                   # Active frontend configuration (git-ignored)
    ├── .env.example           # Standalone frontend environment template
    ├── package.json           # Frontend dependencies & scripts
    ├── vite.config.ts         # Vite bundler & Vitest configuration
    ├── vercel.json            # Vercel deployment & reverse-proxy configuration
    └── src/
        ├── App.tsx            # Root component with auth & routing
        ├── api/               # Typed fetch client, SSE consumer, interfaces
        ├── auth/              # Auth store & session listener
        ├── components/        # Production UI components
        │   ├── chat/          # Message items, markdown, streaming cursor
        │   ├── graph/         # React Flow interactive branch DAG
        │   ├── inspector/     # Memory manager, personalization, Why trace panel
        │   ├── layout/        # AppShell, sidebar, branch switcher, command palette
        │   └── operations/    # Fork dialog, upward merge dialog, sync dialog, diff
        ├── store/             # Zustand stores (workspace, ui, operations, trace)
        └── test/              # All consolidated frontend Vitest suites
```

---

## 4. Core Product Concepts & Git-for-Chat Mechanics

| Git Concept | ChatHUB Concept | Behavioral Guarantee |
| :--- | :--- | :--- |
| **Repository** | **Space** | Isolated project or persona with its own memory universe and owner (`spaces.owner_id`). |
| **Commit** | **Message Node** | One user or assistant turn linked to its parent commit. |
| **Branch** | **Branch** | Independent timeline with customizable persona, system prompt, thinking level, and memory settings. |
| **Fork** | **Fork from Message** | Fork from any message, choosing which memories carry over via an interactive checklist. |
| **Merge** | **Merge Up** | Send selected memories and an AI summary up to an ancestor branch. Messages are never copied. |
| **Pull** | **Sync Upstream** | Pull newly created parent memories into a child branch. |
| **Diff** | **Compare Divergence** | Compare memory sets and message history between any branch and its ancestor. |
| **Tag** | **Checkpoint** | Named snapshot of a specific point in a branch. |
| **Blame** | **Provenance** | Every memory tracks its source commit and origin branch. |

### The Five Non-Negotiable Rules

1. **R0 User Isolation**: Every space belongs to exactly one authenticated user. Queries scope by `spaces.owner_id`. Foreign objects return `404 Not Found`, never `403`.
2. **R1 Upstream-Only Visibility**: A branch can see only its own messages and memories plus ancestors up to the fork point. Siblings, cousins, children, or subsequent upstream commits are completely invisible. Enforced in `visible_commit_ids`.
3. **R2 Explicit Provenance**: Every memory has an origin branch, source commit, and status.
4. **R3 Fork Means Choose**: Forking opens a checklist of inherited memories (keep, exclude, pin, unpin).
5. **R4 Merge Goes Only Upward**: Merging is restricted strictly to branch-tree ancestors.

---

## 5. Security & Hardening Audit Register

All 10 critical security, memory governance, and architectural audit findings have been resolved and verified with dedicated automated tests:

| ID | Severity | Vulnerability / Gap | Fix Implemented | Automated Test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-001** | High | **Host header validation missing:** DNS rebinding vulnerability on local & production ports. | Added `HostHeaderMiddleware` enforcing allowlist (`127.0.0.1`, `localhost`, production domains). | `test_host_header_rejected_when_not_allowed` | `fixed` |
| **SEC-002** | High | **Permissive CSRF & Origin checks:** Cross-site browser requests could trigger mutations. | Enforced strict Origin validation and `X-ChatHUB-Request: 1` header on mutating methods. | `test_mutating_request_origin_validation` | `fixed` |
| **SEC-003** | Critical | **Memory poisoning & prompt injection:** Assistant outputs or malicious prompts could inject standing instructions. | Strict candidate filtering: quarantine assistant/tool content; reject imperative instructions from non-user turns. | `test_memory_poisoning_instruction_rejected` | `fixed` |
| **SEC-004** | High | **Sensitive secrets stored as memories:** API keys (`AIza...`, `sk-...`, `ghp_...`) and high-entropy secrets saved silently. | Integrated Shannon entropy calculation ($\ge 4.2$) and pattern scanner rejecting storage with `400 Bad Request`. | `test_secrets_detection_blocks_api_keys` | `fixed` |
| **ISO-001** | Critical | **Cross-branch canary leakage:** Secrets or canary memories in sibling branches leaking through search or un-scoped queries. | All search, graph, and memory queries filter strictly through `visible_commit_ids`. Zero canary leakage. | `test_canary_secret_never_leaks_to_sibling` | `fixed` |
| **MEM-001** | High | **Incomplete deletion ("Forget" gap):** Soft-deletion leaving residual vectors in Qdrant and text in `trace_json`. | Implemented atomic `forget` operation that deletes memory row, version history, Qdrant vector point, and scrubs trace JSON. | `test_forget_memory_scrubs_all_traces_and_vectors` | `fixed` |
| **CON-001** | High | **Concurrent chat generation race:** Simultaneous messages on the same branch corrupting head commit pointer. | Implemented per-branch async locks returning `409 Conflict` during active generation. | `test_concurrent_chat_lock_returns_409` | `fixed` |
| **BRN-001** | Medium | **Upstream deletion leaves child unaware:** Upstream deletion created invisible memory gaps for children. | Added `status='tombstoned'` state; UI shows "Removed upstream" with an option to keep local copy. | `test_upstream_delete_creates_child_tombstone` | `fixed` |
| **JOB-001** | Medium | **Memory rot & staleness:** Stale, expired, or contradictory memories accumulating without cleanup. | Implemented background consolidation engine with staleness sweep, contradiction sweep, and review inbox. | `test_staleness_sweep_flags_expired_memories` | `fixed` |
| **SCH-001** | High | **Unversioned static database schema:** Inability to run incremental schema updates safely in production. | Implemented `schema_migrations` runner with numbered migrations (`0001_initial_pg.sql`, `0002_hardening_pg.sql`). | `test_schema_migration_runner` | `fixed` |

---

## 6. Automated Evaluations & Chaos Benchmarks

All benchmark evaluations are codified in `backend/tests/test_evals_and_chaos.py`:

| Benchmark | Objective | Methodology & Verification | Result |
| :--- | :--- | :--- | :--- |
| **EVAL-1: Cross-Branch Isolation** | 0% canary leakage across sibling branches | Injected unique canary tokens (`CANARY-ALPHA-9981-SECRET`) across sibling branches; verified zero leakage into context, memories, or traces. | `PASSED` (0% leakage) |
| **EVAL-2: Prompt Injection Defense** | Jailbreak & instruction override rejection | Evaluated against direct system override payloads, developer mode bypasses, and directive disregard strings. | `PASSED` (100% blocked) |
| **EVAL-3: Secret & Entropy Scanner** | Block API keys and high-entropy strings | Tested against live patterns (`AIza...`, `sk-ant-...`, `ghp_...`, JWTs) and random high-entropy strings ($\ge 4.2$ bits). | `PASSED` (400 Bad Request) |
| **EVAL-4: Hybrid MMR Precision** | Penalize redundant near-duplicate context | Dense vectors on the same topic penalized via MMR ($\lambda=0.7$), promoting topic diversity in working memory. | `PASSED` (Diverse context selected) |
| **EVAL-5: Concurrency Chaos** | Branch generation lock resilience | Simulated simultaneous generation requests on the same branch head. Second call receives 409 Conflict; lock reliably releases upon completion. | `PASSED` (409 Conflict + lock release) |
| **EVAL-6: Atomic Forget Scrub** | Complete scrubbing for privacy compliance | Memory row, versions, Qdrant vectors, FTS indexes, and commit trace JSON references completely removed. | `PASSED` (100% scrubbed) |

---

## 7. Architecture Decision Records (ADRs)

- **ADR-001: Local-First with Google Gemini 3.8 Flash**
  - *Context:* Need reliable, current LLM with streaming and thinking support.
  - *Decision:* Standardized on official `google-genai==2.31.0` SDK with `gemini-3.8-flash` and `gemini-embedding-001` (768-dim). Provided deterministic mock fallback for offline operation.
- **ADR-002: Neon PostgreSQL as System of Record**
  - *Context:* Serverless, zero-sleep relational storage with connection pooling for production.
  - *Decision:* Primary database is Neon PostgreSQL with `psycopg` connection pooling. Local SQLite is preserved as a zero-setup fallback.
- **ADR-003: Dual-Mode Vector Retrieval (Qdrant + NumPy)**
  - *Context:* Scalable vector search with two-phase ancestor isolation.
  - *Decision:* Qdrant Cloud client stores vector payloads; local NumPy cosine similarity acts as zero-dependency fallback. Postgres remains the single authority on visibility.
- **ADR-004: Decoupled Independent Deployments**
  - *Context:* Frontend and backend require separate deploy targets (Vercel for frontend SPA, Render/Railway for backend API).
  - *Decision:* Completely decoupled root files. Frontend uses `frontend/.env` with Vite proxy; backend uses `backend/.env` with CORS/Host validation.
- **ADR-005: Per-Branch Async Generation Locks**
  - *Context:* Preventing race conditions on branch head pointers.
  - *Decision:* Acquire in-memory asyncio locks keyed by `branch_id`; simultaneous requests return `409 Conflict`.
- **ADR-006: Outbox Pattern & Background Consolidation**
  - *Context:* Reliable vector sync and asynchronous memory maintenance without slowing user chat responses.
  - *Decision:* Implemented `outbox_events` and background `jobs` runner for vector syncing, staleness sweeps, and contradiction audits.

---

## 8. Production Deployment Guide

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
 │ Neon (PG)    │                                │ Qdrant Cloud │
 │ Relational DB│                                │ Vector DB    │
 └──────────────┘                                └──────────────┘
```

### 1. Database Setup (Neon PostgreSQL)
1. Sign up at [neon.tech](https://neon.tech) and create a project.
2. In `backend/.env`, set `DATABASE_URL` to your pooled connection string:
   ```env
   DATABASE_URL=postgresql://user:password@ep-sample-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```
3. The backend automatically boots with `schema_pg.sql` and applies all migrations on startup.

### 2. Deploy Backend (Render or Railway)
- **Render:**
  - Create a Web Service connected to your repo.
  - Root Directory: `backend` (or use `backend/render.yaml`).
  - Build Command: `pip install -r requirements.txt`
  - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - Add Environment Variables (`APP_HOST=0.0.0.0`, `DATABASE_URL`, `GEMINI_API_KEY`, `ALLOWED_ORIGINS=https://your-app.vercel.app`, `COOKIE_SECURE=true`).
- **Railway:**
  - Deploy from repo. Railway detects `backend/railway.json`.
  - Add the same environment variables.

### 3. Deploy Frontend (Vercel)
- Import repo on [vercel.com](https://vercel.com).
- Root Directory: `frontend`
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Set `VITE_API_URL` to your backend URL (e.g. `https://chathub-backend.onrender.com`).
- The included `frontend/vercel.json` automatically routes `/api/*` to `VITE_API_URL`.

---

## 9. Renaming the Base Directory on Windows

To rename the folder from `New folder` to `ChatHUB` on Windows without file locking conflicts:
```powershell
cd ..
Rename-Item -Path "New folder" -NewName "ChatHUB"
cd ChatHUB
```
All configurations, Git history, and dependencies remain completely intact.
