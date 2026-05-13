#!/usr/bin/env bash
# Uninstall LBS data protection. Does NOT delete backups/ or any snapshots.
#
# Pair with: scripts/install-protection.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Layer 3: stopping and removing the launchd backup job"
if launchctl print "gui/$(id -u)/com.lbs.dbbackup" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)/com.lbs.dbbackup" || true
    echo "    unloaded com.lbs.dbbackup from launchd"
else
    echo "    job was not loaded"
fi

if [ -f ~/Library/LaunchAgents/com.lbs.dbbackup.plist ]; then
    rm ~/Library/LaunchAgents/com.lbs.dbbackup.plist
    echo "    removed ~/Library/LaunchAgents/com.lbs.dbbackup.plist"
else
    echo "    plist was not installed"
fi

echo ""
echo "==> Layer 1: removing the protect-db hook from .claude/settings.json"
if [ -f .claude/settings.json ]; then
    rm .claude/settings.json
    echo "    removed .claude/settings.json"
    echo "    (open /hooks once in Claude Code, or restart the session, to deactivate)"
else
    echo "    .claude/settings.json was not present"
fi

echo ""
echo "Existing snapshots in backups/ are untouched."
echo "The hook script itself (.claude/hooks/protect-db.sh) is kept — delete by hand if you want it gone."
