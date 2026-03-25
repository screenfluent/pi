#!/usr/bin/env bash
# update-commits.sh — Update lastCheckedCommit for all repos in tracker.json
#
# Usage: ./update-commits.sh /path/to/tracker.json

set -euo pipefail

TRACKER_JSON="${1:?Usage: update-commits.sh /path/to/tracker.json}"
REPOS_DIR="$(dirname "$TRACKER_JSON")"

node -e "
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cfg = JSON.parse(fs.readFileSync('$TRACKER_JSON', 'utf-8'));
const reposDir = '$REPOS_DIR';

for (const repo of cfg.repos) {
    const repoDir = path.join(reposDir, repo.name);
    try {
        const commit = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
        repo.lastCheckedCommit = commit;
        repo.lastCheckedAt = new Date().toISOString();
    } catch {}
}

fs.writeFileSync('$TRACKER_JSON', JSON.stringify(cfg, null, 2) + '\n');
console.log('Updated ' + cfg.repos.length + ' repos');
"
