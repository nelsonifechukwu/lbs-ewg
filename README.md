# LBS

A life-management app: sortable to-do lists, one per area of life (dissertation,
jobs, ...). Each tab is its own self-contained module on both ends.

## Prerequisites

- Python 3.11+
- Node 20+

## Setup

```bash
# backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# frontend
cd frontend
npm install
cd ..
```

## Running

```bash
./dev.sh
```

- Backend: <http://localhost:8000> (FastAPI, docs at `/docs`)
- Frontend: <http://localhost:5173> (Vite proxies `/api` to the backend)

Press `Ctrl+C` to stop both.

## Layout

```text
backend/
  main.py                  # FastAPI app, CORS, table creation, router wiring
  db.py                    # sqlite3 connection helper
  tabs/
    dissertation.py        # table + models + router, all in one file
    jobs.py                # same shape

frontend/src/
  main.tsx                 # React entrypoint
  App.tsx                  # sidebar + routes
  tabs/
    registry.ts            # list of tabs shown in the sidebar
    dissertation/DissertationTab.tsx
    jobs/JobsTab.tsx
```

Each tab file is intentionally self-contained — types, fetch helpers, and the
component all live next to each other. Adding a new tab means copying one of the
existing tab files and registering it in `registry.ts` (frontend) + including
its router and table in `main.py` (backend).
