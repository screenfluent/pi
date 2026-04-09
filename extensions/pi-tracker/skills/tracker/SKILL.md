---
name: tracker
description: Analyze changes in tracked Pi extension repositories. Run daily via pi-cron to detect relevant updates. Uses vendor-manifest.json to classify extensions and assess impact.
---

# Extension Tracker

Analyze changes in tracked external repositories and assess impact on local extensions.

## Step 0: Read vendor manifest

Read `~/.pi/agent/extensions/vendor-manifest.json` to understand the strategy for each extension:

| Strategy | Meaning |
|---|---|
| **mirror** | Clean copy. Sync by replacing from upstream. Any local diff = drift to fix. |
| **patch-stack** | Small local mods on top of upstream. Sync = copy upstream + reapply patches. |
| **fork** | Heavily modified. Upstream is informational only. Manual cherry-pick. |
| **local** | No upstream. Not affected by any repo changes. Skip entirely. |

Map tracker repos to manifest extensions via `upstream.localClonePath` matching tracker repo name.

## Step 1: Fetch changes

```bash
~/90-99.system/91.pi-home/extensions/pi-tracker/scripts/fetch-changes.sh ~/90-99.system/92.tracked-repos/tracker.json
```

## Step 2: Parse and classify

For each repo with `hasChanges: true`:

1. Read the commit log and changed files from the JSON output
2. Cross-reference with `vendor-manifest.json` — which of our extensions come from this repo? Match by `upstream.localClonePath` == repo name
3. For each affected extension, filter upstream changed files to those under the extension's `sourcePath`
4. For **patch-stack** extensions: flag files listed in `diffFiles` as "likely patch conflicts". Other files in sourcePath are still relevant (they may need to be copied over).
5. For **fork** extensions: diffFiles are informational only. ALL upstream changes under sourcePath should be reported for potential cherry-picking, not just diffFiles.
6. For **mirror** extensions: all files under sourcePath matter equally.

## Step 3: Assess impact per extension

For each affected extension, determine impact:

- **mirror**: Any upstream change in sourcePath = HIGH. Diff our local copy against upstream to check for drift (we should be identical).
- **patch-stack**: Upstream changes touching diffFiles = HIGH (patch conflicts likely). Other sourcePath changes = MEDIUM (need copy + reapply).
- **fork**: All upstream changes in sourcePath = MEDIUM (informational, manual cherry-pick decision).
- **local**: Skip. Not affected.

## Step 4: Generate report

```markdown
# Extension Tracker Report — YYYY-MM-DD

## [repo-name] — [HIGH/MEDIUM/LOW]

**Commit range:** lastCheckedCommit..currentCommit (N new commits)

### Impact on [ext-name] (strategy)

- **lastSyncedCommit:** abc1234
- **Source path:** extensions/pi-workon/
- **Upstream files changed in sourcePath:** file1.ts, file2.ts
- **diffFiles touched by upstream:** (list any intersection of upstream changed files and our diffFiles)
- **Local diff status:** CLEAN / PATCHED / DRIFTED
- **Key upstream changes:** One-line summaries of relevant commits
- **Recommended action:** sync / re-sync + reapply patches / cherry-pick specific commits / none

---
```

If no upstream changes affect any of our extensions, write: "No relevant changes affecting our extensions."

## Step 5: Save report and update baseline

Save the report to `~/90-99.system/92.tracked-repos/reports/YYYY-MM-DD.md`

Then update the review baseline:
```bash
~/90-99.system/91.pi-home/extensions/pi-tracker/scripts/update-commits.sh ~/90-99.system/92.tracked-repos/tracker.json
```

This advances `tracker.json` `lastCheckedCommit` to the current remote HEAD — the point we've reviewed up to.

## Step 6: Update vendor manifest (only after actual sync)

**Only if you actually synced, copied, or patched an extension** in this session: update the `lastSyncedCommit` field in `~/.pi/agent/extensions/vendor-manifest.json` to the upstream commit you synced to.

If no sync happened, **do not update lastSyncedCommit**. It tracks the actual upstream code reflected in our local copy, not the review baseline.

## Step 7: Memory

Write to **both** memory systems:
- `memory_write` (global daily log)
- `honcho_remember`

For HIGH impact: extension name + one-line summary of what changed and recommended action.
For no relevant changes: "Tracker: no relevant changes"

## Relevance criteria

- **HIGH**: Changes affecting our installed extensions (check diffFiles intersection). Bug fixes, new features, breaking API changes, security fixes.
- **MEDIUM**: Changes outside diffFiles but in our sourcePath. New extensions worth adopting. Architecture patterns.
- **LOW**: Changes to extensions we don't use. Documentation-only changes. Version bumps.