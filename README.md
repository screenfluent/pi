# Pi Agent Home

Personal [Pi](https://github.com/badlogic/pi-mono) coding agent home directory. Symlinked to `~/.pi/agent` so Pi loads extensions, skills, and config from here.

```bash
ln -s /path/to/this/repo ~/.pi/agent
```

## Inspiration

Structure and several extensions adapted from [espennilsen/pi](https://github.com/espennilsen/pi) — Espen's personal Pi agent home. His extensions for project tracking, context switching, shared database, web dashboards, memory, and finance management served as the foundation for this setup. Modified and extended to fit my workflow.

## Directory Layout

```
├── extensions/          # Pi extensions (each has own README.md)
│   └── pi-focus/        # Tool visibility profiles per session
├── skills/              # Custom skills
├── themes/              # TUI themes
├── settings.json        # Global Pi settings
├── models.json          # Custom model config
└── AGENTS.md            # Global agent instructions
```

## Extensions

| Extension | Origin | Description |
|-----------|--------|-------------|
| [**pi-focus**](extensions/pi-focus/) | Generated from scratch by Claude Opus 4.6 High | Toggle tool visibility per session using named profiles |
| [**pi-workon**](extensions/pi-workon/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Project context switching — load AGENTS.md, git status, detect tech stacks |
| [**pi-memory**](extensions/pi-memory/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Persistent memory — long-term facts, daily logs, full-text search (modified: two-layer global+project) |
| [**pi-cron**](extensions/pi-cron/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Cron scheduler — recurring prompts as isolated pi -p subprocesses |
| [**pi-channels**](extensions/pi-channels/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Two-way messaging — Telegram, Slack, webhooks |
| [**pi-kysely**](extensions/pi-kysely/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Shared database registry with table-level RBAC |
| [**pi-webserver**](extensions/pi-webserver/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Shared HTTP server with auth for web extensions |
| [**pi-logger**](extensions/pi-logger/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Centralized structured JSONL logging |
| [**pi-projects**](extensions/pi-projects/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Project tracking dashboard with git status |
| [**pi-td**](extensions/pi-td/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Task management with web dashboard |
| [**pi-calendar**](extensions/pi-calendar/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Calendar with reminders and web dashboard |
| [**pi-personal-crm**](extensions/pi-personal-crm/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Contacts, companies, interactions |
| [**pi-myfinance**](extensions/pi-myfinance/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Personal finance tracking |
| [**pi-heartbeat**](extensions/pi-heartbeat/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Periodic health checks with alerts |
| [**pi-jobs**](extensions/pi-jobs/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Agent run telemetry and cost tracking |
| [**pi-github**](extensions/pi-github/) | [espennilsen/pi](https://github.com/espennilsen/pi) | GitHub PR management, issues, CI |
| [**pi-subagent**](extensions/pi-subagent/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Parallel task delegation via isolated subprocesses |
| [**pi-telemetry**](extensions/pi-telemetry/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Local-only privacy-safe event telemetry |
| [**pi-web-dashboard**](extensions/pi-web-dashboard/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Web dashboard landing page |
| [**pi-webnav**](extensions/pi-webnav/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Web navigation and scraping |
| [**pi-npm**](extensions/pi-npm/) | [espennilsen/pi](https://github.com/espennilsen/pi) | NPM workflow tool |
| [**pi-vault**](extensions/pi-vault/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Obsidian vault integration |
| [**pi-model-router**](extensions/pi-model-router/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Automatic model routing based on task |
| [**pi-brave-search**](extensions/pi-brave-search/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Web search via Brave API |

## Setup

### Prerequisites

- Node.js
- [Pi](https://github.com/badlogic/pi-mono) (`npm install -g @mariozechner/pi-coding-agent`)

### Install

```bash
# Clone repo
git clone git@github.com:screenfluent/pi.git ~/90-99.system/91.pi-home

# Symlink repo contents into ~/.pi/agent/ (preserves auth, sessions, bin)
mkdir -p ~/.pi/agent
for item in extensions skills themes AGENTS.md settings.json LICENSE; do
    src="$HOME/90-99.system/91.pi-home/$item"
    dst="$HOME/.pi/agent/$item"
    [ -e "$src" ] && rm -rf "$dst" && ln -s "$src" "$dst"
done
```

This approach keeps `~/.pi/agent/` as a real directory with Pi runtime files (`auth.json`, `sessions/`, `bin/`) while symlinking managed content from the repo.

### VPS Directory Structure (Johnny Decimal)

```
~/
├── 10-19.life/
│   ├── 11.command-center/       # High-level planning, life management
│   └── 12.finances/
│
├── 30-39.projects/
│   ├── 31.tailwindgallery/
│   └── 32.bookmark-hq/
│
└── 90-99.system/
    └── 91.pi-home/ → ~/.pi/agent   # This repo
```

## License

MIT
