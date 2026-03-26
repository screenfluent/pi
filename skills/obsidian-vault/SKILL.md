---
name: obsidian-vault
description: Read, create, and update notes in the Obsidian vault (PARA method). Use when asked about notes, tasks, projects, daily logs, or anything in the vault.
---

# Obsidian Vault Management

## Vault Location

```
~/20-29.knowledge/21.vault
```

No REST API — filesystem mode only. Use the `obsidian` tool for all operations.

## Structure (PARA)

```
1. Projects/     — Active initiatives with deadlines
2. Areas/        — Ongoing responsibilities
3. Resources/    — Reference materials
4. Archive/      — Completed or inactive items
Notes/Daily/     — Daily notes (YYYY-MM-DD.md)
Tasks/           — TaskNotes (one task per note)
Templates/       — Note templates (Note, Project, Task, Daily, WeeklyReview, Area, Resource)
Weekly Reviews/  — Periodic reflections
```

## Before Making Changes

1. Read the vault's `AGENTS.md` for full conventions
2. Always use templates from `Templates/` when creating new notes
3. Never delete without confirmation

## Conventions

- **Frontmatter required**: `created`, `modified`, `type`, `tags` at minimum
- **Tags**: `type/note`, `project/active`, `status/active`, `area/professional`, `priority/high`
- **Links**: Use `[[wiki-links]]`
- **Tasks**: one file per task in `Tasks/`, named `Project - Task Description.md`

## Common Operations

```
# Create daily note
obsidian action=daily

# Read a note
obsidian action=read path="1. Projects/MyProject.md"

# Search
obsidian action=search query="docker deploy"

# Create from template
obsidian action=create_from_template template="Project" target="1. Projects/New Project.md" variables='{"title":"New Project","date":"2026-03-26"}'

# List directory
obsidian action=list path="1. Projects" recursive=true

# Update frontmatter
obsidian action=frontmatter path="Tasks/MyTask.md" updates='{"status":"done"}'

# Append to note
obsidian action=append path="Notes/Daily/2026-03-26.md" content="## New section\nContent here"

# Recent notes
obsidian action=recent limit=10
```
