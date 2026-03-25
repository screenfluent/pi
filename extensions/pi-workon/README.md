# pi-workon

Project context switching for [pi](https://github.com/badlogic/pi-mono) — switch between projects, load AGENTS.md, git status, detect tech stacks, and scaffold project configs. Originally from [espennilsen/pi](https://github.com/espennilsen/pi).

## Features

- **`/workon` slash command** — quick switch with autocomplete, shows project context
- **`workon` tool** — switch project context, loading AGENTS.md, git status, and open td issues
- **`project_init` tool** — detect tech stack and scaffold AGENTS.md, `.pi/`, and `td` task tracking
- **Auto-discovery** — scans configured directories for projects
- **Aliases** — shorthand names for projects (`/workon blog` → `31.szymonraczka.com`)
- **Status bar** — shows current project name (`📂 project-name`) in the footer
- **Events** — emits `workon:switch` for other extensions (pi-focus, pi-honcho-memory)

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-workon": {
    "devDirs": ["~/30-39.projects"],
    "aliases": {
      "blog": "31.szymonraczka.com",
      "pi": "~/90-99.system/91.pi-home"
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `devDirs` | `["~/Dev"]` | Directories scanned for projects |
| `devDir` | — | Legacy single directory (merged into devDirs) |
| `aliases` | `{}` | Project shortcuts: name → directory name or absolute path |

## Tool: `workon`

| Action | Required params | Description |
|--------|----------------|-------------|
| `switch` | `project` | Switch to a project — loads AGENTS.md, git status, and td issues |
| `status` | — | Show current project context |
| `list` | — | List all projects in devDirs with git branch, AGENTS.md, and td badges |

## Tool: `project_init`

| Action | Required params | Description |
|--------|----------------|-------------|
| `detect` | `project` | Scan project and preview what would be generated (dry run) |
| `init` | `project` | Scaffold AGENTS.md, `.pi/settings.json`, and run `td init` |
| `batch` | — | Scan all projects in devDirs and report init status |

**Init options:** `force` (overwrite existing AGENTS.md), `skip_td`, `skip_agents_md`, `skip_pi_dir`

## License

MIT
