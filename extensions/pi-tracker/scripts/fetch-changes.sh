#!/usr/bin/env bash
# fetch-changes.sh — Fetch all tracked repos and output changes as JSON
#
# Usage: ./fetch-changes.sh /path/to/tracker.json
# Output: JSON array of repos with their changes since last check

set -euo pipefail

TRACKER_JSON="${1:?Usage: fetch-changes.sh /path/to/tracker.json}"

if [ ! -f "$TRACKER_JSON" ]; then
    echo "Error: $TRACKER_JSON not found" >&2
    exit 1
fi

REPOS_DIR="$(dirname "$TRACKER_JSON")"

# Read repo list from tracker.json
REPOS=$(node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$TRACKER_JSON', 'utf-8'));
for (const r of cfg.repos) {
    console.log([r.name, r.lastCheckedCommit || '', r.interests.join('|')].join('\t'));
}
")

echo "["
FIRST=true

while IFS=$'\t' read -r NAME LAST_COMMIT INTERESTS; do
    REPO_DIR="$REPOS_DIR/$NAME"

    if [ ! -d "$REPO_DIR/.git" ]; then
        continue
    fi

    cd "$REPO_DIR"

    # Fetch latest
    git fetch --quiet origin 2>/dev/null || true

    # Get current HEAD of default branch
    DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
    CURRENT_COMMIT=$(git rev-parse "origin/$DEFAULT_BRANCH" 2>/dev/null || git rev-parse origin/main 2>/dev/null || echo "")

    if [ -z "$CURRENT_COMMIT" ]; then
        continue
    fi

    # If no previous commit, just record current
    if [ -z "$LAST_COMMIT" ]; then
        DIFF_STAT=""
        LOG=""
        FILES_CHANGED=""
        HAS_CHANGES="false"
    elif [ "$LAST_COMMIT" = "$CURRENT_COMMIT" ]; then
        DIFF_STAT=""
        LOG=""
        FILES_CHANGED=""
        HAS_CHANGES="false"
    else
        DIFF_STAT=$(git diff --stat "$LAST_COMMIT".."$CURRENT_COMMIT" 2>/dev/null | tail -1 || echo "")
        LOG=$(git log --oneline --no-merges "$LAST_COMMIT".."$CURRENT_COMMIT" 2>/dev/null | head -30 || echo "")
        FILES_CHANGED=$(git diff --name-only "$LAST_COMMIT".."$CURRENT_COMMIT" 2>/dev/null | head -50 || echo "")
        HAS_CHANGES="true"
    fi

    # Output as JSON
    if [ "$FIRST" = "true" ]; then
        FIRST=false
    else
        echo ","
    fi

    node -e "
const obj = {
    name: '$NAME',
    hasChanges: $HAS_CHANGES,
    lastCommit: '$LAST_COMMIT',
    currentCommit: '$CURRENT_COMMIT',
    interests: $(node -e "console.log(JSON.stringify('$INTERESTS'.split('|')))"),
    diffStat: $(node -e "console.log(JSON.stringify(\`$DIFF_STAT\`))"),
    log: $(node -e "console.log(JSON.stringify(\`$LOG\`))"),
    filesChanged: $(node -e "console.log(JSON.stringify(\`$FILES_CHANGED\`.split('\n').filter(Boolean)))")
};
process.stdout.write(JSON.stringify(obj, null, 2));
"

    cd "$REPOS_DIR"
done <<< "$REPOS"

echo ""
echo "]"
