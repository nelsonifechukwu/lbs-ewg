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

## Data protection (lbs.db)

Three layers guard the SQLite file:

1. **PreToolUse hook** — `.claude/hooks/protect-db.sh` blocks Claude Code from
   running `rm`/`mv`/`DROP TABLE`/`drop_all`/`Write`/`Edit` against `lbs.db`.
   Override for one command with `CLAUDE_ALLOW_DB_DESTROY=1`.
2. **Snapshot on every `./dev.sh` start** — automatic, no setup. Copies live to
   `backups/lbs.db.bak-<timestamp>` and prunes >30 days old.
3. **Hourly launchd job** — uses SQLite's online backup API. Survives
   mid-session loss.

### Setup (one-time, per machine)

```bash
./scripts/install-protection.sh
```

Then open `/hooks` once in Claude Code (or restart the session) so the hook is
picked up.

### Restore from a snapshot

```bash
# Stop dev.sh first (Ctrl+C).
./scripts/restore-db.sh                       # interactive picker
./scripts/restore-db.sh backups/lbs.db.bak-20260513-115632
```

### Remove everything

```bash
./scripts/uninstall-protection.sh             # removes hook + launchd job
```

Snapshots in `backups/` are never deleted by uninstall — only by the >30-day
prune in `dev.sh` and the launchd job.

### Cross-machine sync via iCloud Drive (optional)

```bash
# Stop dev.sh first.
./scripts/icloud-sync.sh
```

Moves `backend/lbs.db` into iCloud Drive and replaces it with a symlink, so the
live DB syncs across machines under the same Apple ID. Run the backend on only
one machine at a time. The script is idempotent — re-run it on a fresh clone
to recreate the symlink.
