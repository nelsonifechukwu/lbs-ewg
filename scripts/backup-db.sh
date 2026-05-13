#!/usr/bin/env bash
# Snapshot backend/lbs.db using SQLite's online backup API (safe while the DB
# is being written to). Keeps 30 days of hourly snapshots in backups/.
# Called by launchd; also safe to run manually.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="$REPO_ROOT/backend/lbs.db"
DEST_DIR="$REPO_ROOT/backups"

if [ ! -f "$DB" ]; then
    exit 0
fi

mkdir -p "$DEST_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST_DIR/lbs.db.bak-$TS"

# .backup uses the SQLite backup API — safe even mid-write, unlike plain cp on
# a WAL database.
/usr/bin/sqlite3 "$DB" ".backup '$OUT'"

find "$DEST_DIR" -name 'lbs.db.bak-*' -type f -mtime +30 -delete 2>/dev/null || true
