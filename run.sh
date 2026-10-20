#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Add GEMINI_API_KEY for live mode."
fi

if [ ! -x backend/.venv/bin/python ]; then
  py -3.12 -m venv backend/.venv
fi

backend/.venv/bin/python -m pip install --disable-pip-version-check -r backend/requirements.txt
if [ ! -d frontend/node_modules ]; then
  npm --prefix frontend install
fi

mkdir -p data
backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "${BACKEND_PORT:-8000}" --app-dir backend &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT:-8000}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

npm --prefix frontend run dev
