---
name: weekly-review
description: Run a structured weekly review covering projects, habits, goals, and planning. Use when asked for a weekly review, week summary, or weekly planning session.
---

# Weekly Review

## Purpose

Help Szymon reflect on the past week and plan the next one. Covers projects, habits, personal development, and priorities.

## Process

### 1. Gather Context

Read recent activity to build a picture of the week:

```bash
# Recent daily notes (last 7)
ls -t ~/20-29.knowledge/21.vault/Notes/Daily/ | head -7
```

```bash
# Read each daily note for habits and content
for f in $(ls -t ~/20-29.knowledge/21.vault/Notes/Daily/ | head -7); do
  echo "=== $f ==="
  cat ~/20-29.knowledge/21.vault/Notes/Daily/"$f"
  echo
done
```

```bash
# Recent git activity across projects
for d in ~/30-39.projects/*/; do
  [ -d "$d/.git" ] || continue
  log=$(git -C "$d" log --oneline --since="7 days ago" --no-merges 2>/dev/null | head -5)
  [ -n "$log" ] && echo "=== $(basename $d) ===" && echo "$log"
done
```

```bash
# Pi agent home changes
git -C ~/90-99.system/91.pi-home log --oneline --since="7 days ago" --no-merges | head -10
```

```
# AI usage stats for the week (pi-jobs tool)
jobs action=cost_report period=week
jobs action=stats period=week
```

```
# Memory activity
memory_read target=list
```

### 2. Review Structure

Present findings organized as:

**🏆 Wins** — What went well, what was accomplished
**📋 Active Projects** — Status of each active project, progress this week
**🎯 Habits Check-in** — How did the daily habits go? (work first consume later, exercise, evening reflection)
**💰 AI Costs** — Token usage and costs for the week (from pi-jobs)
**⚡ Blockers** — What's stuck and why
**📅 Next Week** — Top 3 priorities, experiments to try

### 3. Ask Szymon

After presenting the review, ask:
- "Anything I missed or got wrong?"
- "What should be the #1 priority next week?"
- "Any new projects or ideas to capture?"

### 4. Capture (with permission)

If Szymon wants, create a weekly review note in the vault:
```
Weekly Reviews/Week YYYY-WNN.md
```

Use the WeeklyReview template. **Always confirm before writing to the vault.**

### 5. Update Memory

After the review is confirmed:
- Update global MEMORY.md "Active Focus" section if priorities changed
- Write a global daily log entry summarizing the review

## Tone

Supportive but honest. Celebrate wins. Don't sugarcoat missed goals — frame them as data for adjustment, not failure. Focus on what's within control, let go of what isn't.
