#!/usr/bin/env bash
# Move backend/lbs.db to iCloud Drive and symlink it back, so the live DB
# syncs across machines under the same Apple ID.
#
# Idempotent: re-running is a no-op if already symlinked.
# Reversible: a timestamped pre-move copy is left in backend/ for rollback.
#
# Run with the backend stopped.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

DB="backend/lbs.db"
ICLOUD_BASE="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
ICLOUD_DIR="$ICLOUD_BASE/lbs"
ICLOUD_DB="$ICLOUD_DIR/lbs.db"

if [ -L "$DB" ]; then
    echo "Already a symlink -> $(readlink "$DB")"
    exit 0
fi

if [ ! -d "$ICLOUD_BASE" ]; then
    echo "iCloud Drive not enabled. Enable it in System Settings > Apple Account > iCloud > Drive." >&2
    exit 1
fi

if lsof -i :8000 -nP -t >/dev/null 2>&1; then
    echo "Backend is running on :8000. Stop dev.sh first (Ctrl+C)." >&2
    exit 1
fi

if [ ! -f "$DB" ]; then
    echo "No local DB at $DB. Boot the backend once to create it, then re-run." >&2
    exit 1
fi

mkdir -p "$ICLOUD_DIR"

if [ -f "$ICLOUD_DB" ]; then
    echo "iCloud already has $ICLOUD_DB."
    read -r -p "Overwrite with local $DB? [y/N] " ans
    [[ "$ans" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

SAFETY="$DB.pre-icloud-$(date +%Y%m%d-%H%M%S)"
cp "$DB" "$SAFETY"
echo "Pre-move snapshot saved: $SAFETY"

/usr/bin/sqlite3 "$DB" ".backup '$ICLOUD_DB'"

if ! /usr/bin/sqlite3 "$ICLOUD_DB" "PRAGMA integrity_check;" | grep -qx "ok"; then
    echo "Integrity check failed on $ICLOUD_DB. NOT swapping. Local DB untouched." >&2
    exit 1
fi
echo "iCloud copy verified clean."

rm "$DB"
ln -s "$ICLOUD_DB" "$DB"
echo ""
echo "Done. $DB now points at $ICLOUD_DB"
echo "Roll back any time with:  rm '$DB' && mv '$SAFETY' '$DB'"
echo ""
echo "Caveats:"
echo "  - Run dev.sh on only one machine at a time."
echo "  - After stopping on machine A, wait a few seconds for iCloud to finish"
echo "    syncing before starting on machine B."
echo "  - On a fresh machine: clone the repo, then run this script again — it"
echo "    will detect the existing iCloud DB and re-create the symlink."
