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
│   ├── pi-focus/        # Tool visibility profiles per session
│   ├── pi-tracker/      # Extension repository monitor
│   └── ...
├── skills/              # Custom skills
├── themes/              # TUI themes
├── settings.json        # Global Pi settings
└── AGENTS.md            # Global agent instructions
```

## Extensions

| Extension | Origin | Description |
|-----------|--------|-------------|
| [**pi-focus**](extensions/pi-focus/) | Generated from scratch by Claude Opus 4.6 High | Toggle tool visibility per session using named profiles |
| [**pi-tracker**](extensions/pi-tracker/) | Generated from scratch by Claude Opus 4.6 High | Extension repo monitor — daily fetch, AI analysis, web dashboard |
| [**pi-workon**](extensions/pi-workon/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Project context switching — load AGENTS.md, git status, detect tech stacks |
| [**pi-memory**](extensions/pi-memory/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Persistent memory — two-layer (global + project), daily logs, search |
| [**pi-cron**](extensions/pi-cron/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Cron scheduler — recurring prompts as isolated pi -p subprocesses |
| [**pi-channels**](extensions/pi-channels/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Two-way messaging — Telegram, Slack, webhooks |
| [**pi-webserver**](extensions/pi-webserver/) | [espennilsen/pi](https://github.com/espennilsen/pi) | Shared HTTP server with auth for web extensions |

### Planned (from espennilsen/pi)

| Extension | Description |
|-----------|-------------|
| **pi-kysely** | Shared database registry with table-level RBAC |
| **pi-logger** | Centralized structured JSONL logging |
| **pi-projects** | Project tracking dashboard with git status |
| **pi-td** | Task management with web dashboard |
| **pi-calendar** | Calendar with reminders and web dashboard |
| **pi-personal-crm** | Contacts, companies, interactions |
| **pi-myfinance** | Personal finance tracking |

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
for item in extensions skills themes AGENTS.md LICENSE; do
    src="$HOME/90-99.system/91.pi-home/$item"
    dst="$HOME/.pi/agent/$item"
    [ -e "$src" ] && rm -rf "$dst" && ln -s "$src" "$dst"
done

# Settings: LOCAL COPY (not symlink) — add secrets like pi-channels config here
cp ~/90-99.system/91.pi-home/settings.json ~/.pi/agent/settings.json
```

This approach keeps `~/.pi/agent/` as a real directory with Pi runtime files (`auth.json`, `sessions/`, `bin/`) while symlinking managed content from the repo. `settings.json` is a local copy because it contains secrets (e.g. Telegram `allowedChatIds`) that shouldn't be in the public repo. When repo settings change, manually sync non-secret parts to the local copy.

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
├── 90-99.system/
│   ├── 91.pi-home/ → ~/.pi/agent   # This repo
│   └── 92.tracked-repos/            # Cloned repos monitored by pi-tracker
│       ├── tracker.json
│       ├── reports/
│       ├── espennilsen-pi/
│       ├── pi-guardrails/
│       └── agent-stuff/
```

## License

MIT
