# Pi Agent Home

Personal [Pi](https://github.com/badlogic/pi-mono) coding agent home directory. Symlinked to `~/.pi/agent` so Pi loads extensions, skills, and config from here.

```bash
ln -s /path/to/this/repo ~/.pi/agent
```

## Inspiration

Structure and several extensions adapted from [espennilsen/pi](https://github.com/espennilsen/pi) — Espen's personal Pi agent home. His extensions for project tracking, context switching, shared database, web dashboards, memory, and finance management served as the foundation for this setup. Modified and extended to fit my workflow.

## Directory Layout

```
├── extensions/          # Pi extensions (each has own package.json)
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
| **pi-focus** | Custom | Toggle tool visibility per session using named profiles (`/focus coding`, `/focus life`, `/focus show`) |

### Planned (from espennilsen/pi)

| Extension | Description |
|-----------|-------------|
| **pi-workon** | Project context switching — load AGENTS.md, git status, detect tech stacks |
| **pi-projects** | Project tracking dashboard with git status |
| **pi-kysely** | Shared database registry with table-level RBAC |
| **pi-webserver** | Shared HTTP server with auth for web extensions |
| **pi-logger** | Centralized structured JSONL logging |
| **pi-memory** | Persistent long-term memory, daily logs, search |
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
# Clone to wherever you keep repos
git clone git@github.com:screenfluent/pi.git ~/pi-home

# Symlink as Pi agent home
ln -s ~/pi-home ~/.pi/agent

# Install extension dependencies
cd ~/pi-home/extensions/pi-focus && npm install 2>/dev/null; cd ~/pi-home
```

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

## pi-focus

Toggle tool visibility per session using named profiles. Integrates with `pi-workon` for automatic profile switching when changing projects.

### Commands

| Command | Description |
|---------|-------------|
| `/focus` | TUI select dialog — pick a profile |
| `/focus <name>` | Switch directly to a profile |
| `/focus show` | Show active/disabled tools |

### Configuration

In `settings.json`:

```json
{
  "pi-focus": {
    "profiles": {
      "coding": {
        "description": "Dev tools only",
        "exclude": ["calendar_*", "crm_*", "finance_*"]
      },
      "life": {
        "description": "Life management",
        "include": ["calendar_*", "crm_*", "finance_*", "read", "bash", "write", "edit"]
      },
      "all": {
        "description": "Everything enabled"
      }
    },
    "projects": {
      "31.tailwindgallery": "coding",
      "11.command-center": "all"
    }
  }
}
```

Profile rules:
- `include` — whitelist (only these tools active)
- `exclude` — blacklist (all except these)
- neither — all tools active
- Patterns support trailing `*` wildcard (e.g., `calendar_*`)

`projects` maps project names (from `pi-workon`) to profiles for automatic switching.

## License

MIT
