#!/usr/bin/env bash
# Install LBS data protection. Idempotent — safe to re-run.
#
# Sets up two layers:
#   - Layer 1: Claude Code PreToolUse hook that blocks rm/DROP/etc. on lbs.db
#   - Layer 3: launchd job that snapshots lbs.db every hour to backups/
#
# (Layer 2 — snapshot on dev.sh startup — is hardcoded in dev.sh; nothing to do.)
#
# Pair with: scripts/uninstall-protection.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Layer 1: registering protect-db.sh as a PreToolUse hook"
mkdir -p .claude
cat > .claude/settings.json <<'EOF'
{
    "hooks": {
        "PreToolUse": [
            {
                "matcher": "Bash|Write|Edit",
                "hooks": [
                    {
                        "type": "command",
                        "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/protect-db.sh"
                    }
                ]
            }
        ]
    }
}
EOF
echo "    wrote .claude/settings.json"
echo "    (open /hooks once in Claude Code, or restart the session, to activate)"

echo ""
echo "==> Layer 3: installing hourly launchd backup job"
mkdir -p ~/Library/LaunchAgents

# Render the plist with this machine's absolute paths. Done at install time so
# the repo itself never carries a hardcoded $HOME path.
cat > ~/Library/LaunchAgents/com.lbs.dbbackup.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lbs.dbbackup</string>

    <key>ProgramArguments</key>
    <array>
        <string>$REPO_ROOT/scripts/backup-db.sh</string>
    </array>

    <key>StartInterval</key>
    <integer>3600</integer>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$REPO_ROOT/backups/launchd.log</string>

    <key>StandardErrorPath</key>
    <string>$REPO_ROOT/backups/launchd.err</string>
</dict>
</plist>
EOF

# bootstrap fails if the label is already loaded — bootout first to make it
# idempotent.
if launchctl print "gui/$(id -u)/com.lbs.dbbackup" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)/com.lbs.dbbackup" || true
fi
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.lbs.dbbackup.plist
echo "    plist installed and loaded — backups run every hour"

echo ""
echo "Done. Verify with:"
echo "    launchctl print gui/\$(id -u)/com.lbs.dbbackup | head -20"
echo "    ls -la backups/"
