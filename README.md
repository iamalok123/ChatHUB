# BranchMind

BranchMind treats a conversation like a Git repository: a **Space** is the repository, a **Branch** is a chat thread, and **Memories** are versioned, inherited, and mergeable.

This repository is being built in phases. The authoritative build contract lives in [AGENTS.md](AGENTS.md). Architecture decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Stack

- FastAPI + SQLite (WAL) backend
- Vite + React + TypeScript frontend
- Google Gemini via the official `google-genai` SDK
- Mock AI provider when no Gemini key is configured
- Email/password auth with Argon2id and opaque session cookies

## Quick start

```powershell
./run.ps1
```

Open `http://127.0.0.1:5173`.

The first run creates a Python 3.12 virtual environment, installs dependencies, and starts both servers. Add `GEMINI_API_KEY` to `.env` to enable live Gemini calls; otherwise the app runs in clearly labelled mock mode.

## Manual setup

```powershell
py -3.12 -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
npm --prefix frontend install
Copy-Item .env.example .env
```

Run the backend:

```powershell
backend/.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir backend
```

Run the frontend:

```powershell
npm --prefix frontend run dev
```

## What works today

- Create an account, sign in, restore a session, update the profile or password, and sign out.
- Switch between light, dark, and system themes without a flash on reload.
- Browse spaces and the branch tree, filter branches, inspect inherited messages, and view effective and excluded memories.
- Export a space to JSON or import an export as a new owned space.
- Use the responsive shell: the sidebar is a drawer below 900px and the inspector is a drawer below 1280px.
- See the mock/live provider state and a privacy explanation in Settings. Mock mode is labelled throughout.

The chat composer, memory editing, fork/merge dialogs, and the full Why trace are the next UI phase. The backend operations already exist.

## Verify

```powershell
backend/.venv/Scripts/python -m pytest backend/tests -o addopts="" -q
backend/.venv/Scripts/python -m ruff check backend/app backend/tests
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

## Privacy

- The SQLite database, sessions, and exports stay on this machine.
- The backend never exposes the Gemini key to the browser.
- In live mode, prompt text, selected memories, and extraction context are sent to the Google Gemini API.
- Mock mode makes no network AI calls and requires no API key.
- Session cookies are HttpOnly and SameSite=Lax; every API route except auth and health requires a session.

## Status

Phases 0-6 establish the toolchain, database, authentication boundary, branch visibility, Gemini/mock providers, streaming branch chat, traces, regenerate-as-new-branch, the memory engine, the Git-like operations (fork, upward-only merge, sync, diff, checkpoints, export/import), and the authenticated frontend shell with settings and responsive memory inspection.

Phase 7 adds the streaming chat experience, markdown rendering, reasoning steps, and message actions.
