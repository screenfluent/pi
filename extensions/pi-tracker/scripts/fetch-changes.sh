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

# Use node to iterate repos — avoids tab/delimiter parsing bugs
node -e "
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cfg = JSON.parse(fs.readFileSync('$TRACKER_JSON', 'utf-8'));
const reposDir = '$REPOS_DIR';
const results = [];

for (const repo of cfg.repos) {
    const repoDir = path.join(reposDir, repo.name);
    if (!fs.existsSync(path.join(repoDir, '.git'))) continue;

    // Fetch
    try { execSync('git fetch --quiet origin', { cwd: repoDir, timeout: 30000 }); } catch {}

    // Get current HEAD of default branch
    let currentCommit = '';
    try {
        const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
        const branch = ref.replace('refs/remotes/origin/', '');
        currentCommit = execSync('git rev-parse origin/' + branch, { cwd: repoDir, encoding: 'utf-8' }).trim();
    } catch {
        try { currentCommit = execSync('git rev-parse origin/main', { cwd: repoDir, encoding: 'utf-8' }).trim(); } catch {}
    }

    if (!currentCommit) continue;

    const lastCommit = repo.lastCheckedCommit || '';
    const result = {
        name: repo.name,
        interests: repo.interests || [],
        lastCommit,
        currentCommit,
        hasChanges: false,
        diffStat: '',
        log: '',
        filesChanged: []
    };

    if (lastCommit && lastCommit !== currentCommit) {
        result.hasChanges = true;
        const range = lastCommit + '..' + currentCommit;
        try { result.diffStat = execSync('git diff --stat ' + range, { cwd: repoDir, encoding: 'utf-8', timeout: 10000 }).trim().split('\\n').pop() || ''; } catch {}
        try { result.log = execSync('git log --oneline --no-merges ' + range, { cwd: repoDir, encoding: 'utf-8', timeout: 10000 }).trim(); } catch {}
        try { result.filesChanged = execSync('git diff --name-only ' + range, { cwd: repoDir, encoding: 'utf-8', timeout: 10000 }).trim().split('\\n').filter(Boolean); } catch {}
    } else if (!lastCommit) {
        // First run — no baseline yet
        result.hasChanges = false;
    }

    results.push(result);
}

console.log(JSON.stringify(results, null, 2));
"
