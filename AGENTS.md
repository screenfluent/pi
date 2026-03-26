# Pi Agent Home

Personal Pi agent configuration. Extensions, skills, and settings live here.
Symlinked to `~/.pi/agent/` — Pi loads this as global context.

## Directory Layout

```
├── extensions/
│   ├── pi-focus/        # Tool visibility profiles (/focus coding, /focus all)
│   ├── pi-memory/       # Two-layer persistent memory (global + project)
│   ├── pi-workon/       # Project context switching (/workon)
│   ├── pi-cron/         # Cron scheduler for recurring prompts
│   ├── pi-channels/     # Telegram/Slack/webhook bridge
│   ├── pi-webserver/    # Shared HTTP server for dashboards (port 4100)
│   ├── pi-tracker/      # External repo monitor with web dashboard
│   ├── pi-honcho-memory/ # Persistent memory via Honcho (search, chat, remember)
│   ├── pi-vault/        # Obsidian vault integration (read, write, search, dashboard)
│   ├── pi-telemetry/    # Session event logging (JSONL)
│   └── pi-jobs/         # Agent run tracking — tokens, costs, duration, web dashboard
├── skills/
│   ├── obsidian-vault/  # Vault management instructions (PARA, conventions, safety)
│   └── pi-memory/       # Memory system usage (two-layer, when to write, hygiene)
├── themes/
├── settings.json        # Global settings (repo version — no secrets)
└── AGENTS.md            # This file
```

## Settings

- `~/.pi/agent/settings.json` is a LOCAL COPY, not symlink — contains secrets (pi-channels telegram config)
- Repo `settings.json` has non-secret defaults only
- When repo settings change, manually sync non-secret parts to local copy

## Memory — Dual System (A/B Test)

Two memory systems run in parallel for comparison. **Write to both** when saving anything:

- **pi-memory** (`memory_write`) — file-based, two-layer (global + project), auto-injected into system prompt
- **honcho** (`honcho_remember`) — semantic, self-hosted, auto-injected into system prompt

Personal facts, preferences, habits → `honcho_remember` + `memory_write` (global scope)
Technical, project-specific → `memory_write` (project scope) + `honcho_remember`
Session tracking → `memory_write` daily log (both scopes as appropriate)

See `/skill:pi-memory` for detailed rules on what goes where.

## Conventions

- Extensions communicate via `pi.events` (event bus), never direct imports
- Settings use `pi-<name>` keys in settings.json
- Tools return structured text for LLM consumption
- Secrets (tokens, chat IDs) go in local settings or env vars, never in repo

## VPS Structure (Johnny Decimal)

```
~/10-19.life/11.command-center/    # Global memory (MEMORY.md + daily logs)
~/20-29.knowledge/21.vault/        # Obsidian vault (PARA structure, managed by pi-vault)
~/30-39.projects/                  # Project workspaces
~/90-99.system/91.pi-home/         # This repo
~/90-99.system/92.tracked-repos/   # Repos monitored by pi-tracker
```

## Key Data Paths

- Global memory: `~/10-19.life/11.command-center/`
- Obsidian vault: `~/20-29.knowledge/21.vault/`
- Tracker config: `~/90-99.system/92.tracked-repos/tracker.json`
- Tracker reports: `~/90-99.system/92.tracked-repos/reports/`
- Web dashboard: `http://localhost:4100` (/cron, /tracker, /vault)
