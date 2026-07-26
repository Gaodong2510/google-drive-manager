#!/usr/bin/env bash
# Local / manual start (without full install.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GDM_DATA_DIR="${GDM_DATA_DIR:-$ROOT/data}"
export GDM_HOST="${GDM_HOST:-0.0.0.0}"
export GDM_PORT="${GDM_PORT:-8787}"

if [[ ! -d "$ROOT/venv" ]]; then
  python3 -m venv "$ROOT/venv"
  # shellcheck disable=SC1091
  source "$ROOT/venv/bin/activate"
  pip install -U pip
  pip install -r "$ROOT/backend/requirements.txt"
else
  # shellcheck disable=SC1091
  source "$ROOT/venv/bin/activate"
fi

if [[ ! -d "$ROOT/frontend/dist" ]]; then
  (cd "$ROOT/frontend" && npm install && npm run build)
fi

cd "$ROOT/backend"
exec python -m uvicorn app.main:app --host "$GDM_HOST" --port "$GDM_PORT"
