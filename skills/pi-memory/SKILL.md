---
name: pi-memory
description: Manage persistent memory across sessions. Use when asked to remember, recall, forget, or review what was stored. Covers long-term facts (MEMORY.md), daily session logs, search, and memory housekeeping.
---

# pi-memory — Persistent Memory

A file-based memory system that persists knowledge across sessions using plain Markdown. Two-layer architecture: global (cross-project) and project (per-project).

## Architecture

### Global memory (`~/10-19.life/11.command-center/`)
```
MEMORY.md              # User preferences, habits, cross-project goals, people
memory/
    ├── 2026-03-26.md  # Daily log — high-level: WHAT happened
    ├── 2026-03-25.md
    └── ...
```

### Project memory (`.pi/memory/` in project root, activated by `/workon`)
```
MEMORY.md              # Architecture decisions, tech stack, conventions, domain knowledge
memory/
    ├── 2026-03-26.md  # Daily log — detailed: HOW and WHY
    └── ...
```

## Tools

### memory_read

Read memory contents.

| target | scope | description |
|--------|-------|-------------|
| `long_term` | global or project | Read MEMORY.md |
| `daily` | global or project | Read a date's log (default: today). Pass `date: "YYYY-MM-DD"` for other dates. |
| `list` | — | List all available daily log files |

### memory_write

Write to memory. Use `scope: "global"` or `scope: "project"` to target a layer.

| target | description |
|--------|-------------|
| `daily` | Append a timestamped entry to today's log |
| `long_term` | Update MEMORY.md. Pass `section` to replace a specific `## Section`, or omit to append. |

**Long-term memory sections** — use `section` parameter to target:
```
memory_write target=long_term section="Preferences" scope="global" content="- Terminal-first tools"
```
This replaces the content under `## Preferences`. If the section doesn't exist, it's created.

**Daily log entries** — auto-timestamped:
```
memory_write target=daily scope="global" content="14:00 blog — implemented RSS feed"
```
Creates `### HH:MM` entry in today's file.

### memory_search

Full-text search across all MEMORY.md files and daily logs (both global and project).

```
memory_search query="JWT" limit=10
```

Returns matching lines with context, grouped by file.

## When to Write Memory

### Global daily log — always:
- At START of a work session: timestamp + project name + brief intent
- At END of a work session: duration + one-line outcome
- Keep entries to ONE LINE per session

### Project daily log — during active work:
- What was implemented, problems encountered, solutions chosen
- Key decisions during a task
- Blockers encountered and resolved
- As detailed as needed

### Global long-term memory (MEMORY.md) — when:
- User says "remember this" and it's personal/cross-project
- New preference, habit, or convention learned
- Cross-project goals or priorities change
- People, contacts, relationships

### Project long-term memory (MEMORY.md) — when:
- Significant architectural or design choice is made
- Tech stack decisions, coding conventions for that project
- Domain knowledge specific to the project
- Open questions or unresolved issues

## Section Organization for MEMORY.md

### Global
```markdown
## Environment
## Preferences
## Active Focus
## People & Relationships
```

### Project
```markdown
## Architecture
## Tech Stack
## Conventions
## Domain Knowledge
## Open Questions
```

## Memory Hygiene

Periodically review and clean up memory:

1. **Deduplicate** — Check for repeated sections in MEMORY.md
2. **Archive stale info** — Remove outdated decisions or completed project references
3. **Consolidate daily logs** — Important patterns from daily logs should be promoted to MEMORY.md
4. **Keep sections focused** — Each `## Section` should have a clear purpose

## System Prompt Injection

At each agent turn, the extension automatically injects into the system prompt:
- Global MEMORY.md
- Global yesterday's + today's daily log
- Project MEMORY.md (when `/workon` is active)
- Project yesterday's + today's daily log (when `/workon` is active)

This means the agent always has recent context without needing to call `memory_read`.

## Dual Memory System (A/B Test)

Two memory systems run in parallel to compare quality over time:

- **pi-memory** — file-based (MEMORY.md + daily logs), structured, grep-searchable
- **honcho** — semantic memory via self-hosted Honcho, learns from conversations, semantic search

### Rules for dual writes

When saving anything to memory, **write to both systems**:

1. `memory_write` — to the appropriate scope/target (global or project, daily or long_term)
2. `honcho_remember` — a concise fact/preference/decision

This ensures both systems have the same data for fair comparison. After extended use, we'll evaluate which system provides better recall, context, and usefulness — then pick a winner or define complementary roles.

### When to use honcho_search vs memory_search

- `memory_search` — keyword/grep lookup, good for exact terms
- `honcho_search` — semantic lookup, good for "what did we decide about X" type questions
- When in doubt, use both

## Language

Always write memory entries in English, regardless of conversation language.
