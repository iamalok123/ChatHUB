# ChatHUB Production Readiness, Testing & Deployment Plan

This document establishes the authoritative production test plan, environment configuration matrix, and single-command execution workflow for ChatHUB. It ensures that the frontend and backend are completely decoupled, independently deployable, and rigorously verified.

---

## 1. System Architecture & Folder Organization

ChatHUB is structured with complete decoupling between frontend and backend:

```text
ChatHUB/
├── .env.example               # Root unified environment template
├── .gitignore                 # Strict ignores for credentials, databases, build artifacts
├── package.json               # Root single-command convenience runner
├── run.ps1 / run.cmd / run.sh # Unified single-command launcher with health-check polling
├── AGENTS.md                  # Comprehensive engineering contract
├── README.md                  # Product manual and architecture guide
├── docs/
│   ├── AUDIT.md               # Hardening audit register (10/10 fixed & verified)
│   ├── DECISIONS.md           # Architecture Decision Records (ADRs)
│   ├── HARDENING.md           # Security, memory & governance playbook
│   └── PRODUCTION_TEST_PLAN.md# This document: production testing & deployment plan
├── backend/                   # Independent Python 3.12 FastAPI Service
│   ├── .env.example           # Standalone backend environment template
│   ├── requirements.txt       # Production dependencies
│   ├── pyproject.toml         # Python packaging & ruff configuration
│   ├── Procfile               # Railway & container entrypoint
│   ├── railway.json           # Railway platform blueprint
│   ├── render.yaml            # Render platform blueprint
│   ├── app/                   # Clean production source code (no test clutter)
│   │   ├── main.py            # App factory, security middleware, lifespans
│   │   ├── config.py          # Dual-env loading (backend/.env, root/.env, $PORT)
│   │   ├── db.py              # Dual-mode engine (PostgreSQL NeonDB / SQLite)
│   │   ├── visibility.py      # Core R1 ancestor commit & memory isolation
│   │   ├── migrations.py      # Automated versioned schema migration runner
│   │   ├── auth/              # Passwords (Argon2id), session tokens, deps
│   │   ├── engine/            # Context composer, retrieval (RRF+MMR), chat, jobs
│   │   ├── llm/               # Gemini SDK provider, Qdrant client, mock fallback
│   │   ├── ops/               # Fork, merge, sync, diff, checkpoints, export
│   │   ├── repo/              # Repositories for spaces, branches, commits, memories
│   │   └── routes/            # REST and SSE Server-Sent Events endpoints
│   └── tests/                 # All 96+ backend test suites (strictly isolated)
└── frontend/                  # Independent Vite + React 19 + TypeScript SPA
    ├── .env.example           # Standalone frontend environment template
    ├── package.json           # Frontend dependencies, scripts (test, build, lint)
    ├── vite.config.ts         # Vite bundler, proxy configuration & Vitest setup
    ├── tsconfig*.json         # Strict TypeScript compiler options
    ├── vercel.json            # Vercel deployment & reverse-proxy configuration
    └── src/
        ├── App.tsx            # Root component with auth & routing
        ├── index.css          # Design system CSS variables & typography tokens
        ├── api/               # Typed client with VITE_API_URL support & SSE stream
        ├── auth/              # Auth screen & session management
        ├── components/        # Pure production UI components (no test clutter)
        │   ├── chat/          # Message items, markdown, streaming cursor
        │   ├── graph/         # React Flow interactive branch DAG
        │   ├── inspector/     # Memory manager, tombstones, Why trace panel
        │   ├── layout/        # AppShell, responsive sidebar, command palette
        │   └── operations/    # Fork, merge, sync, compare divergence dialogs
        ├── lib/               # Utility functions (graphLayout, branchTree, format)
        ├── store/             # Zustand state stores (workspace, ui, operations, trace)
        └── test/              # All 14 consolidated frontend Vitest suites
```

---

## 2. Environment Configuration Matrix

The frontend and backend have separate, explicit environment configurations:

### Backend Environment (`backend/.env.example`)
| Variable | Purpose | Default | Production Value |
| :--- | :--- | :--- | :--- |
| `APP_HOST` | Host to bind backend | `127.0.0.1` | `0.0.0.0` (containers) |
| `BACKEND_PORT` / `PORT` | Listening port | `8000` | Injected by Render/Railway |
| `DATABASE_URL` | PostgreSQL connection | *empty (SQLite fallback)* | NeonDB connection string with `sslmode=require` |
| `QDRANT_URL` | Vector database URL | *empty (NumPy fallback)* | `https://xxxx.cloud.qdrant.io:6333` |
| `QDRANT_API_KEY` | Vector database API key | *empty* | Qdrant Cloud API Key |
| `GEMINI_API_KEY` | Google Gemini API key | *empty (Mock mode)* | Live Gemini API Key |
| `LLM_MODE` | Model execution mode | `auto` | `gemini` or `auto` |
| `ALLOWED_ORIGINS` | CORS allowed origins | `http://localhost:5173` | `https://chathub.vercel.app` |
| `ALLOWED_HOSTS` | Host header validation | `127.0.0.1,localhost` | `chathub-backend.onrender.com` |
| `COOKIE_SECURE` | HttpOnly cookie security | `false` | `true` (HTTPS required) |
| `ENVIRONMENT` | Environment toggle | `development` | `production` (hides OpenAPI/docs) |

### Frontend Environment (`frontend/.env.example`)
| Variable | Purpose | Local Dev | Production (Vercel) |
| :--- | :--- | :--- | :--- |
| `VITE_API_URL` | Backend API URL | *empty* (uses `/api` proxy) | `https://chathub-backend.onrender.com` (or empty if using `vercel.json` rewrites) |
| `PORT` | Frontend dev server port | `5173` | Set by host |
| `BACKEND_PORT` | Vite proxy target port | `8000` | N/A |

---

## 3. How to Run Everything with Just ONE Command

No need to open separate terminals or launch backend and frontend individually. You can use any of these one-command workflows:

### Method A: npm (Universal)
```powershell
npm start
```
*Or:*
```powershell
npm run dev:all
```

### Method B: PowerShell Script
```powershell
./run.ps1
```

### Method C: Windows Command Prompt
```cmd
run.cmd
```

### Method D: Linux / macOS / WSL
```bash
./run.sh
```

**What the one-command launcher does automatically:**
1. Validates or initializes `.env` from `.env.example`.
2. Sets up Python virtual environment and installs backend dependencies if modified.
3. Installs frontend dependencies if `node_modules` is absent.
4. Starts the FastAPI backend on `http://127.0.0.1:8000`.
5. Polls the `/api/health` endpoint until the backend is fully healthy.
6. Starts the Vite frontend on `http://127.0.0.1:5173`.
7. Intercepts `Ctrl+C` to gracefully terminate both frontend and backend processes simultaneously.

---

## 4. Comprehensive Production Test Plan

Before pushing to production, execute the 5-stage test verification:

### Stage 1: Static Analysis & Linting
Verifies zero syntax errors, type mismatches, or style violations:
```powershell
npm run lint
```
*Verifications:*
- `oxlint`: Scans frontend TypeScript/React files (0 errors).
- `ruff check backend`: Scans backend Python files (0 errors).

### Stage 2: Frontend Test Suite (Vitest)
Executes all 14 isolated test suites:
```powershell
npm run test:frontend
```
*Key test areas covered:*
1. `App.test.tsx`: Sign-in, sign-up, session persistence, drawer sidebar, logout.
2. `BranchView.test.tsx`: Streaming SSE chat, transcript settlement, Why trace drawer.
3. `CommandPalette.test.tsx`: Keyboard shortcuts (`Ctrl+K`), fuzzy branch search.
4. `CompareDialog.test.tsx`: Memory and message divergence against ancestors.
5. `MemoryPanel.test.tsx`: Proposals, conflict resolution, overrides, manual addition, tombstones.
6. `Operations.test.tsx`: Fork with checklist, unpinning, upward merge with summary.
7. `PersonalizationPanel.test.tsx`: Space profile and branch voice configuration.
8. `MessageItem.performance.test.tsx`: Virtualized/optimized re-rendering on 500-turn transcripts.
9. `TracePanel.test.tsx`: Ranked memories, score breakdowns, synthetic context summary labels.
10. `client.test.ts` & `sse.test.ts`: Header injection (`X-ChatHUB-Request`), SSE block parsing.

### Stage 3: Backend Test Suite (Pytest)
Executes all 96 backend tests:
```powershell
npm run test:backend
```
*Key test areas covered:*
1. `test_auth.py`: Argon2id password hashing, session cookies, CSRF header requirements.
2. `test_visibility.py`: R1 ancestor commit walk, sibling and cousin complete invisibility.
3. `test_memories.py`: Provenance, effective memory calculations, status flags.
4. `test_memory_service.py`: Centralized lifecycle state machine, undo, atomic forget.
5. `test_hybrid_retrieval.py`: Reciprocal Rank Fusion, MMR vector diversity re-ranking ($\lambda=0.7$).
6. `test_chat.py`: Concurrency locks (`409 Conflict`), streaming token generation.
7. `test_ops.py`: Fork preview, upward merge deduplication, upstream sync, diff.
8. `test_migrations.py`: Schema v2 migrations runner, outbox table, memory events.
9. `test_outbox.py`: Outbox background event consumer and retry resiliency.
10. `test_evals_and_chaos.py`:
    - **EVAL 1:** Cross-branch canary isolation (0% leakage benchmark).
    - **EVAL 2:** Prompt injection detection and quarantine benchmark.
    - **EVAL 3:** High-entropy secret and credential scanner benchmark ($\ge 4.2$ bits).
    - **EVAL 4:** MMR diversity re-ranking benchmark.
    - **EVAL 5:** Concurrency chaos and generation lock recovery.
    - **EVAL 6:** Atomic forget deep-scrub completeness for GDPR compliance.

### Stage 4: Production Compilation & Bundling
```powershell
npm run build
```
*Verifications:*
- TypeScript compiler (`tsc -b`) reports zero typing issues.
- Vite creates optimized minified assets in `frontend/dist/`.
- Dynamic code splitting separates `BranchGraph` DAG visualizer into an on-demand bundle.

### Stage 5: Health & Security Verification
Verify backend health and provider detection:
```powershell
# Windows PowerShell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health"
```
*Verifications:*
- `status`: `"ok"`
- `llm_mode`: `"gemini"` (or `"mock"` if offline)
- `provider.reachable`: `true`
- No secret keys leaked in API responses.

---

## 5. Deployment Step-by-Step Runbook

### Step 1: Deploy Database (NeonDB)
1. Create a PostgreSQL project on [neon.tech](https://neon.tech).
2. Copy the pooled connection string (`postgresql://...sslmode=require`).
3. No manual SQL execution needed: ChatHUB automatically runs migrations on startup.

### Step 2: Deploy Vector DB (Qdrant Cloud)
1. Create a free 1GB cluster on [cloud.qdrant.io](https://cloud.qdrant.io).
2. Obtain cluster URL and API key.

### Step 3: Deploy Backend (Render or Railway)
- **Render:**
  - Create new **Web Service** from GitHub repo.
  - Root Directory: `backend`
  - Build Command: `pip install -r requirements.txt`
  - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - Set Environment Variables:
    - `DATABASE_URL` = `<your-neondb-url>`
    - `QDRANT_URL` = `<your-qdrant-url>`
    - `QDRANT_API_KEY` = `<your-qdrant-key>`
    - `GEMINI_API_KEY` = `<your-gemini-key>`
    - `ALLOWED_ORIGINS` = `https://<your-vercel-app>.vercel.app`
    - `ALLOWED_HOSTS` = `<your-backend-app>.onrender.com`
    - `COOKIE_SECURE` = `true`
    - `ENVIRONMENT` = `production`
- **Railway:**
  - Import repo and set Root Directory to `backend` (Railway reads `backend/Procfile` and `backend/railway.json`).
  - Add the same environment variables.

### Step 4: Deploy Frontend (Vercel)
1. Import repo into [vercel.com](https://vercel.com).
2. Set Root Directory to `frontend`.
3. Framework Preset: **Vite**.
4. Set Environment Variable:
   - `VITE_API_URL` = `https://<your-backend-app>.onrender.com`
5. Deploy. `frontend/vercel.json` will proxy `/api/*` requests, preserving first-party cookies and SSE streaming.
