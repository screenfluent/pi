---
name: obsidian-vault
description: Read, create, and update notes in the Obsidian vault (PARA method). Use when asked about notes, tasks, projects, daily logs, or anything in the vault.
---

# Obsidian Vault Management

## Vault Location

```
~/20-29.knowledge/21.vault
```

Filesystem mode only (no Obsidian REST API). Use the `obsidian` tool for all operations.

## ⚠️ Safety

**Always confirm with Szymon before creating, modifying, or deleting any vault file.**

The vault follows strict conventions (frontmatter, tags, templates). Breaking these patterns makes notes harder to find and query later.

## Before Making Changes

1. Read the vault's own `AGENTS.md` for full context on structure, conventions, and tag taxonomy
2. Check `Templates/` before creating any new note — always use an existing template
3. Never delete notes without explicit confirmation

## Structure (PARA)

```
1. Projects/     — Active initiatives with deadlines (start + end)
2. Areas/        — Ongoing responsibilities without end date (blog, career, health)
3. Resources/    — Reference materials (bookmarks, guides, inspirations, repos, tweets)
4. Archive/      — Completed or inactive items
Notes/Daily/     — Daily notes (YYYY-MM-DD.md)
Tasks/           — TaskNotes (one task per note)
Templates/       — Note templates (Note, Project, Task, Daily, WeeklyReview, Area, Resource)
Weekly Reviews/  — Periodic reflections
```

## Conventions

- **Frontmatter** is required on all notes: `created`, `modified`, `type`, `tags` at minimum
- **Tags** follow the taxonomy: `#project/active`, `#type/note`, `#status/active`, `#priority/high`, `#area/professional`
- **File naming**: Use descriptive names. TaskNotes use format: `Project - Task Description.md`
- **Templates**: Always use existing templates rather than creating notes from scratch. Check `Templates/` first.
- **Links**: Use `[[wiki-links]]` for internal references, `[[note|display text]]` for custom display
- **Dates**: ISO format `YYYY-MM-DD` everywhere (frontmatter, filenames, daily notes)

## Common Operations (obsidian tool)

### Read & Navigate
```
obsidian action=read path="1. Projects/MyProject.md"
obsidian action=list path="1. Projects" recursive=true
obsidian action=recent limit=10
obsidian action=document_map path="1. Projects/MyProject.md"
```

### Create & Write
```
obsidian action=daily
obsidian action=daily date="2026-03-26" content="Added a brain dump section"
obsidian action=write path="3. Resources/AI/Cool Repo.md" content="---\ncreated: 2026-03-26\n..."
obsidian action=create_from_template template="Project" target="1. Projects/New Project.md" variables='{"title":"New Project","date":"2026-03-26"}'
```

### Edit & Update
```
obsidian action=append path="Notes/Daily/2026-03-26.md" content="## New section\nContent here"
obsidian action=patch path="1. Projects/MyProject.md" target="Tasks" target_type="heading" operation="append" content="- [ ] New task"
obsidian action=frontmatter path="Tasks/MyTask.md" updates='{"status":"done"}'
obsidian action=frontmatter path="1. Projects/MyProject.md"
```

### Search
```
obsidian action=search query="docker deploy"
obsidian action=search query="bookmark" limit=10
```

### Delete
```
obsidian action=delete path="4. Archive/old-note.md"
```

## Filesystem Fallback Reference

When the `obsidian` tool is unavailable, direct filesystem access works:

```bash
VAULT=~/20-29.knowledge/21.vault

# Read a note
cat "$VAULT/1. Projects/MyProject.md"

# Find by name
find "$VAULT" -name "*.md" | grep -i "search term"

# Find by content
grep -rl "search term" "$VAULT" --include="*.md"

# Find by tag in frontmatter
grep -rl "project/active" "$VAULT" --include="*.md"

# Recent daily notes
ls -lt "$VAULT/Notes/Daily/" | head -10

# All tasks with status
grep -l "status:" "$VAULT/Tasks/"*.md 2>/dev/null
```
