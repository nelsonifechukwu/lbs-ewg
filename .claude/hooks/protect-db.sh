#!/usr/bin/env bash
# Blocks any tool call that would destroy backend/lbs.db.
# Receives the tool input as JSON on stdin (hook contract).
# Exit 2 + stderr message = block the tool call.

set -u
input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"

block() {
    printf 'BLOCKED: %s\n' "$1" >&2
    printf 'lbs.db is protected. To override, set CLAUDE_ALLOW_DB_DESTROY=1 and retry.\n' >&2
    exit 2
}

# Per-instance override escape hatch — user sets the env var for one specific
# operation if they really mean it.
if [[ "${CLAUDE_ALLOW_DB_DESTROY:-}" == "1" ]]; then
    exit 0
fi

case "$tool_name" in
    Bash)
        cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
        # Normalize: lowercase + collapse whitespace, so patterns are robust to
        # variations like "RM   LBS.DB" or "rm\tlbs.db".
        norm="$(printf '%s' "$cmd" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ')"
        # Filesystem-level destruction of lbs.db. The trailing pattern requires
        # lbs.db to be a whole filename — followed by end-of-string, whitespace,
        # or a SQLite sidecar suffix — so names like "com.lbs.dbbackup.plist"
        # don't false-match.
        DB_END='lbs\.db(-wal|-shm|-journal)?([[:space:]]|$)'
        if [[ "$norm" =~ (^|[[:space:]/])(rm|mv|shred|truncate|dd)[[:space:]].*$DB_END ]]; then
            block "filesystem deletion/rename targeting lbs.db ($cmd)"
        fi
        if [[ "$norm" =~ \>[[:space:]]*[^[:space:]]*$DB_END ]]; then
            block "shell redirection clobbering lbs.db ($cmd)"
        fi
        # SQL-level destruction patterns.
        if [[ "$norm" =~ drop[[:space:]]+table ]]; then
            block "DROP TABLE in command ($cmd)"
        fi
        if [[ "$norm" =~ truncate[[:space:]]+table ]]; then
            block "TRUNCATE TABLE in command ($cmd)"
        fi
        if [[ "$norm" =~ metadata\.drop_all ]]; then
            block "SQLModel/SQLAlchemy drop_all() in command ($cmd)"
        fi
        ;;
    Write|Edit)
        file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
        case "$file_path" in
            *lbs.db|*lbs.db-journal|*lbs.db-wal|*lbs.db-shm)
                block "direct Write/Edit to $file_path (would corrupt the SQLite file)"
                ;;
        esac
        ;;
esac

exit 0
