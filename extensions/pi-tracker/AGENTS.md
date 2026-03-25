# pi-tracker

Extension repository monitor. Tracks external repos for changes relevant to our Pi setup.

## Architecture

- `src/index.ts` — extension entry: `/tracker` command, web dashboard mount, API endpoints
- `src/tracker.html` — web dashboard (served via pi-webserver at `/tracker`)
- `scripts/fetch-changes.sh` — Node script: fetches repos, diffs against last checked commit, outputs JSON
- `scripts/update-commits.sh` — updates `lastCheckedCommit` and `lastCheckedAt` in tracker.json
- `skills/tracker/SKILL.md` — skill for AI-driven analysis of changes

## Data

All data lives in `~/90-99.system/92.tracked-repos/`:
- `tracker.json` — repo list with URLs, interests, last checked commit/date
- `reports/` — generated Markdown reports (YYYY-MM-DD.md)
- `<repo-name>/` — cloned repositories

## API (via pi-webserver)

- `GET /api/tracker` — returns tracker.json config
- `GET /api/tracker/reports` — returns list of reports with content

## Workflow

1. `fetch-changes.sh` fetches all repos and outputs JSON with diffs
2. AI analyzes changes against repo interests (HIGH/MEDIUM/LOW relevance)
3. Report saved to `reports/`
4. `update-commits.sh` updates baselines in tracker.json
5. Relevant findings written to global memory

Triggered by `/tracker run` or daily via pi-cron.
