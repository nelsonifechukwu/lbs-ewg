# LBS — project context for Claude

A personal life-management app. Sortable to-do lists, one per area of life
(currently: dissertation, jobs — more will be added). Single user, single
machine, single source of truth (`backend/lbs.db`).

This file is the load-bearing summary of how this project is built. When
the project's paradigms change, **update this file in the same commit** so
future sessions stay aligned.

---

## Stack

- **Backend**: FastAPI + SQLModel + sqlite3, Pydantic v2, Python 3.10+
- **Frontend**: Vite + React 18 + TypeScript + Tailwind + react-router-dom + @dnd-kit/sortable
- One repo, two services. Vite proxies `/api` → `http://localhost:8000`.
- DB at `backend/lbs.db`, **symlinked into iCloud Drive** for cross-machine sync.

## Run / setup

- `bin/setup` (macOS/Linux/WSL/Git Bash) or `bin/setup.ps1` (native Windows) — idempotent, one-command bootstrap.
- `./bin/dev` — boots backend (:8000) and frontend (:5173). Takes a snapshot first via `bin/backup`.

---

## The rule that overrides every other rule

**Never destroy `lbs.db`. Ever.** It holds the user's actual life data.

There is a PreToolUse hook at `.claude/hooks/protect-db.sh` that refuses
Bash commands matching `rm`/`mv`/`dd`/`shred`/`truncate` against `lbs.db`,
plus `DROP TABLE`, `TRUNCATE TABLE`, `metadata.drop_all`, and any
`Write`/`Edit` whose `file_path` is `lbs.db` (or its `-wal`/`-shm`/`-journal`
sidecars). It also catches `> backend/lbs.db` redirects.

The hook exists because a past session ran `rm -f backend/lbs.db` as part
of smoke-testing and wiped real data. **Do not let that happen again.**

If you need a throwaway DB for testing, do **not** override the hook with
`CLAUDE_ALLOW_DB_DESTROY=1`. Instead, test against the running backend on
:8000 and clean up by deleting your own test rows by id (filter titles
prefixed `x-test-` is a common pattern). Snapshots live in `backups/` and
sync to iCloud — the user can restore if something goes wrong, but don't
make that necessary.

---

## Architecture paradigm: self-contained per tab

Each "tab" (an area of life) is two files, both self-contained:

- `backend/tabs/{name}.py` — SQLModel table + Pydantic I/O models + APIRouter with five endpoints, **all in one file**
- `frontend/src/tabs/{name}/{Name}Tab.tsx` — types + fetch helpers + component + inner `SortableRow`, **all in one file**

**The tab files are mirrors of each other.** Dissertation and Jobs are
near-identical by design. Do not extract a "base tab" abstraction, do not
add custom hooks shared between tabs, do not factor out a shared
`api.ts`, do not introduce a repository class or service layer.

The principle: **top-to-bottom readability beats DRY when each tab is
small.** A new contributor (human or AI) can read one tab file as a
linear narrative — types → fetch → component → row — and have the full
mental model. The "duplication" between tabs is the cost of that
clarity, and it's the right trade for this codebase.

## File-internal order

**Backend (`backend/tabs/{name}.py`)** — strictly:
1. Imports
2. SQLModel table class (`class X(SQLModel, table=True): ...`)
3. Pydantic I/O models: `ItemCreate`, `ItemUpdate`, `ReorderRequest`
4. `router = APIRouter(prefix="/api/{name}", ...)`
5. Five endpoints: GET list, POST create, PATCH update, DELETE, POST reorder

**Frontend (`frontend/src/tabs/{name}/{Name}Tab.tsx`)** — strictly:
1. Imports
2. `const TAB_ID = '{name}'` + `type X = {...}` + `type SearchResult = {...}`
3. Fetch helpers as plain async functions: `fetchX`, `createX`, `patchX`, `deleteX`, `reorderX`, `searchTasks`
4. The component (state → handlers → JSX)
5. `type RowProps` + inner `SortableRow` component

---

## Cross-tab coupling (the only "shared" parts)

Three places list every tab. Adding a tab means touching exactly these
three plus the two new tab files:

1. **`backend/main.py`** — `app.include_router(...)` for the new router
2. **`backend/search.py`** — the `TABS = [(id, label, Model), ...]` list (used by `/api/search` and could power any future cross-tab feature)
3. **`frontend/src/tabs/registry.ts`** — the `tabs = [...]` array with `name`, `icon`, `path`, `listUrl`, `Component`

The landing page (`frontend/src/LandingPage.tsx`) and the sidebar in
`App.tsx` read from the frontend registry, so they pick up new tabs
automatically with no extra wiring.

## Adding a new tab — checklist

1. **Copy** `backend/tabs/jobs.py` → `backend/tabs/{new_name}.py`. Rename `JobApplication` → `{NewName}`, `jobs_applications` → `{plural}`, and `/api/jobs/applications` → `/api/{new_name}/{plural}`.
2. **Copy** `frontend/src/tabs/jobs/JobsTab.tsx` → `frontend/src/tabs/{new_name}/{NewName}Tab.tsx`. Rename `Application` → `{NewName}`, `apps` → `{plural}`, etc. Update `TAB_ID`.
3. **Add** the tab to `TABS` in `backend/search.py`.
4. **Add** the tab to `tabs` in `frontend/src/tabs/registry.ts` with `listUrl: '/api/{new_name}/{plural}'`.
5. **Register** the new router in `backend/main.py`.
6. **No migration step** — `SQLModel.metadata.create_all(engine)` runs at startup and creates the new table.

If the new tab needs a column the existing tabs don't have, the migration
pattern is in `backend/db.py::_migrate()`: an idempotent
`ALTER TABLE ... ADD COLUMN` block. SQLite is forgiving with that.

---

## Invariants the backend enforces

- **Same-tab title uniqueness, case-insensitive.** Both POST and PATCH check `func.lower(Model.title) == payload.title.lower()` and return 409 on conflict. PATCH excludes the current row via `Model.id != current_id`.
- **Done items sink to bottom.** Every list endpoint uses `ORDER BY done ASC, position ASC`.
- **`position` is float, not int.** Drag-reorder reassigns positions 1..N; floats give room to insert between items without renumbering.
- **Timestamps are timezone-aware UTC.** `default_factory=lambda: datetime.now(timezone.utc)`. JSON ships as ISO 8601.

## UX paradigms

- **Server is the source of truth.** After every mutation (create / toggle / edit / delete / reorder) the FE refetches the list. The only optimistic update is the drag-reorder visual.
- **Destructive actions are two-step.** Delete `✕` morphs into a red "Delete?" pill on first click; second click within 3s confirms. Per-row local state.
- **Inline edit, not modals.** Click a title → row expands to stacked title + URL inputs. Save on Enter or focus-leaves-container; Escape cancels. Empty title cancels.
- **Cross-tab dup handling.** Live debounced search shows suggestions from other tabs as the user types. On exact-match submit: red banner if same-tab (hard block), amber prompt if other-tab ("add here too?"). If the source row was done, the new row is created as done.
- **No modals anywhere.** Inline banners between the input and the list, or pill-state buttons.

---

## Color palette — keep this consistent

| Color | Meaning | Examples |
|---|---|---|
| **emerald-600** | completion / progress | progress bars, checkbox tick, ✓ in suggestions |
| **sky-600 / sky-700** | interaction / action | active sidebar nav, edit-input focus, action buttons, URL `↗` link |
| **rose-50 / 200 / 500 / 700** | error / hard block | same-tab duplicate banner, delete confirm pill |
| **amber-50 / 200** | soft confirm / prompt | cross-tab "add here too?" banner |
| **slate-700 / 500 / 400** | text hierarchy | primary / muted / done-greyed |
| **stone-50** | page background | — |
| **white + slate-200 border** | cards | — |

The dual emerald/sky split is deliberate: **emerald = "this is done",
sky = "you are doing this".** Don't collapse them.

## Styling

- Tailwind utility classes inline. No CSS modules, no styled-components, no extracted class abstractions.
- `shadow-sm` at most. No heavy shadows, no gradients.
- Generous padding (`px-4 py-2.5` for rows, `px-8 py-8` for the page container, `max-w-3xl mx-auto` for content width).
- Animations are dnd-kit's transition defaults only.

---

## Out of scope — don't add unprompted

- Auth / users / sessions / multi-tenancy
- Tests (unit, integration, e2e)
- Docker / docker-compose / Kubernetes
- Deployment configs / CI / hosting
- ORMs beyond SQLModel (no standalone SQLAlchemy patterns, no Alembic, no Tortoise)
- Migrations framework — the `_migrate()` function in `db.py` is the entire migration system
- Logging frameworks / structlog / observability tooling
- Shared abstractions between tab files (custom hooks, base classes, generic components)
- React state-management libraries (Redux, Zustand, Jotai, Recoil)
- Dark mode
- Form libraries (react-hook-form, formik) — plain `useState` is enough
- Animation libraries beyond dnd-kit
- Service workers / PWA features
- WebSockets / SSE / real-time push

If a feature you're building seems to need one of these, **propose the
alternative first** and let the user choose. Don't add it on your own
initiative.

---

## Data protection — the four layers

| # | Layer | What it does |
|---|---|---|
| 1 | **PreToolUse hook** | `.claude/hooks/protect-db.sh` refuses destructive tool calls against `lbs.db` |
| 2 | **Snapshot on `bin/dev` start** | Calls `bin/backup` before booting uvicorn |
| 3 | **Hourly launchd backup** | macOS LaunchAgent runs `bin/backup` every 3600s |
| 4 | **iCloud Drive symlink** | `backend/lbs.db` → `~/Library/Mobile Documents/.../lbs/lbs.db`; continuous sync |

Snapshots land in `backups/lbs.db.bak-<timestamp>`, pruned at 30 days.
Restore with `./bin/restore` (interactive or by path).

## Operational scripts (all in `bin/`, no `.sh` extension)

| Script | Purpose |
|---|---|
| `setup`, `setup.ps1` | one-time per-machine bootstrap (idempotent) |
| `dev` | boot backend + frontend (snapshots first) |
| `backup` | snapshot `lbs.db` → `backups/`, prune >30d |
| `restore` | restore from a snapshot (interactive or by path) |
| `icloud-sync` | one-time move `lbs.db` → iCloud Drive + symlink back |
| `install-protection` | register the hook + install hourly launchd job |
| `uninstall-protection` | undo Layer 1 + Layer 3 |

---

## Commit hygiene

- **One commit per logical feature/fix**, not per file.
- Subject line imperative ("add X", "block Y", "switch Z to W"), <70 chars.
- Body explains the *why* and any non-obvious gotcha.
- Co-author trailer for AI-assisted commits:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- **The protect-db hook can block your commit** if the message body contains literal "DROP TABLE", "TRUNCATE TABLE", etc. Workaround: write the message to a file and use `git commit -F /tmp/msg.txt`.

## When testing

- Backend smoke tests: hit `http://localhost:8000/...` while `bin/dev` is running.
- **Don't run against the user's DB if you'll mutate or delete state.** Create test rows with a recognizable prefix (e.g. `x-test-foo`), exercise the endpoint, then delete those rows by id. The hook will block any attempt to wipe the DB directly.
- Frontend changes hot-reload through Vite. No restart needed for `.tsx` / `.ts` / `.css` changes.
- Backend changes hot-reload through `uvicorn --reload`. Schema changes (new columns) need a restart so `_migrate()` re-runs, but uvicorn's reload handles that.

---

## Files-of-interest map

```
backend/
  main.py              — FastAPI app, CORS, lifespan, router includes
  db.py                — engine + init_db (creates tables + runs _migrate)
  search.py            — /api/search; TABS list = source of cross-tab truth
  tabs/{name}.py       — one file per tab (see paradigm above)

frontend/src/
  App.tsx              — sidebar + routes
  LandingPage.tsx      — aggregate progress across all tabs
  tabs/registry.ts     — tabs array = single source of FE cross-tab truth
  tabs/{name}/{N}Tab.tsx — one file per tab

bin/                   — every operational script lives here
.claude/hooks/         — protect-db.sh (don't disable lightly)
backups/               — local snapshots (gitignored)
docs/                  — long-form walkthroughs
```

---

## When in doubt

- Read an existing tab file end-to-end. The patterns are there.
- If a change feels like it needs a new abstraction, it probably doesn't — write the duplicated version first; abstract only on the third occurrence.
- If a change feels like it needs a new dependency, propose first.
- If a change risks data, snapshot first (`./bin/backup`).
