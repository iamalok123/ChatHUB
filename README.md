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

## Privacy

- The SQLite database stays on this machine.
- The backend never exposes the Gemini key to the browser.
- In live mode, prompt text, selected memories, and extraction context are sent to the Google Gemini API.
- Mock mode makes no network AI calls.

## Status

Phase 0 and Phase 1 establish the toolchain, database, authentication boundary, and branch visibility core. Chat, memory, Git-like operations, and the full UI follow in later phases.
