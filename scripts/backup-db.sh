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

TS="$(date +%Y%m%d-%H%M%S)"

snapshot_to() {
    local dir="$1"
    mkdir -p "$dir"
    # .backup uses the SQLite backup API — safe even mid-write, unlike plain cp.
    /usr/bin/sqlite3 "$DB" ".backup '$dir/lbs.db.bak-$TS'"
    find "$dir" -name 'lbs.db.bak-*' -type f -mtime +30 -delete 2>/dev/null || true
}

# Always: local snapshot
snapshot_to "$DEST_DIR"

# If iCloud Drive is enabled, also drop a snapshot there. Same file across all
# the user's machines, so any machine can restore from any past hour.
ICLOUD_BACKUPS="$HOME/Library/Mobile Documents/com~apple~CloudDocs/lbs/backups"
if [ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]; then
    snapshot_to "$ICLOUD_BACKUPS"
fi
