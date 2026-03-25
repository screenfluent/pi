---
name: tracker
description: Analyze changes in tracked Pi extension repositories. Run daily via pi-cron to detect relevant updates.
---

# Extension Tracker

Analyze changes in tracked external repositories and generate a report.

## Steps

1. Run the fetch script to get changes:
```bash
~/90-99.system/91.pi-home/extensions/pi-tracker/scripts/fetch-changes.sh ~/90-99.system/92.tracked-repos/tracker.json
```

2. Parse the JSON output. For each repo with `hasChanges: true`:
   - Read the commit log and changed files
   - Compare against the repo's `interests` field
   - Assess relevance: HIGH (directly affects extensions I use), MEDIUM (interesting patterns/approaches), LOW (unrelated)

3. Generate a report in this format:
```
# Extension Tracker Report — YYYY-MM-DD

## [repo-name] — [HIGH/MEDIUM/LOW]
**Commits:** N new commits
**Summary:** One paragraph of what changed and why it matters to me.
**Action:** Update recommended / Worth reviewing / No action needed

---
(repeat for each repo with changes)
```

4. Save the report:
```bash
~/90-99.system/91.pi-home/extensions/pi-tracker/scripts/update-commits.sh ~/90-99.system/92.tracked-repos/tracker.json
```

5. Write to global memory:
   - If any HIGH relevance: write daily entry with repo name + one-line summary
   - If all LOW: write daily entry "Tracker: no relevant changes"

## Relevance criteria

- HIGH: Changes to extensions I have installed (pi-workon, pi-memory, pi-cron, pi-channels, pi-webserver, pi-focus). Bug fixes, new features, breaking changes.
- HIGH: New extension that solves a problem I have.
- MEDIUM: Interesting patterns, architecture decisions, or approaches I could adopt.
- LOW: Changes to extensions I don't use. Documentation-only changes. Version bumps.
