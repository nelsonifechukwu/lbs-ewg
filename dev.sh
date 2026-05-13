#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

(cd backend && uvicorn main:app --reload --port 8000) &
BACKEND_PID=$!

(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true' SIGINT SIGTERM EXIT

wait
