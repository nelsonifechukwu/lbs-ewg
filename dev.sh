#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Snapshot lbs.db before booting the backend, so each session has a recoverable
# checkpoint. Cheap (single cp), and prunes anything older than 30 days.
if [ -f backend/lbs.db ]; then
    mkdir -p backups
    cp backend/lbs.db "backups/lbs.db.bak-$(date +%Y%m%d-%H%M%S)"
    find backups -name 'lbs.db.bak-*' -type f -mtime +30 -delete 2>/dev/null || true
fi

(cd backend && .venv/bin/uvicorn main:app --reload --port 8000) &
BACKEND_PID=$!

(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true' SIGINT SIGTERM EXIT

wait
