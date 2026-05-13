# LBS

A life-management app: sortable to-do lists, one per area of life (dissertation,
jobs, ...). Each tab is its own self-contained module on both ends.

## Prerequisites

- Python 3.10+
- Node 20+

(macOS users: `brew install python@3.13 node`. Linux: your distro's package
manager. Windows native: install both from python.org / nodejs.org, **plus**
either Git Bash or WSL2 to run the bash scripts.)

## First-time setup

One command. Idempotent — re-run any time:

**macOS / Linux / WSL / Git Bash:**

```bash
bin/setup
```

**Windows (PowerShell):**

```powershell
bin\setup.ps1
```

What `bin/setup` does:

1. Verifies Python 3.10+ and Node 20+ are present (with install hints if not)
2. Creates `backend/.venv` and installs Python deps
3. Runs `npm install` in `frontend/`
4. Marks every shipped `.sh` script executable
5. (macOS only) Installs the data protection hook + hourly launchd backup —
   set `LBS_SKIP_PROTECTION=1` to skip

After it finishes, open `/hooks` once in Claude Code so the `protect-db.sh`
hook becomes active for this session.

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
