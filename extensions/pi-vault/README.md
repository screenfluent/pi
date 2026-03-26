# pi-vault

Obsidian vault integration for [pi](https://github.com/badlogic/pi-mono) — read, write, search, and manage notes with a 16-action tool and a web health dashboard.

Based on [@e9n/pi-vault](https://github.com/espennilsen/pi) by Espen Nilsen. Modified for filesystem-only usage on a headless VPS (no Obsidian desktop, no REST API).

## Features

- **`obsidian` tool** — read, write, append, patch, search, daily notes, templates, frontmatter, and more
- **Filesystem-first** — works directly on Markdown files, no Obsidian app required
- **REST API support** — optional, for environments with Obsidian Local REST API running
- **Web dashboard** at `/vault` — daily note streak, project health, task breakdown, tag usage, recent activity

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-vault": {
    "vaultPath": "~/20-29.knowledge/21.vault",
    "vaultName": "vault"
  }
}
```

Optional (only if Obsidian REST API is available):

```json
{
  "pi-vault": {
    "apiUrl": "http://127.0.0.1:27123"
  }
}
```

```bash
export OBSIDIAN_API_KEY="your-api-key-here"
```

| Setting | Required | Default | Description |
|---------|----------|---------|-------------|
| `vaultPath` | Yes | — | Path to vault root (`~` expansion supported) |
| `vaultName` | No | basename of `vaultPath` | Vault name for deep links |
| `apiUrl` | No | `http://127.0.0.1:27123` | Obsidian Local REST API URL |
| `OBSIDIAN_API_KEY` (env) | No | — | API key (only needed with REST API) |

## Tool: `obsidian`

| Action | API Required | Description |
|--------|:---:|-------------|
| `read` | No | Read a note by path |
| `write` | No | Create or overwrite a note |
| `append` | No | Append content to a note |
| `patch` | Partial | Insert at heading, block ref, or frontmatter field |
| `delete` | No | Delete a note |
| `search` | No | Full-text search (grep fallback without API) |
| `dataview` | Yes | Run a Dataview DQL query |
| `search_jsonlogic` | Yes | JsonLogic structured search |
| `list` | No | Directory listing |
| `create_from_template` | No | Create a note from a vault template |
| `frontmatter` | No | Read or update YAML frontmatter |
| `recent` | No | List recently modified notes |
| `daily` | No | Read or create a daily note |
| `open` | Yes | Open a file in the Obsidian UI |
| `commands` | Yes | List or execute Obsidian commands |
| `document_map` | No | List headings, block refs, and frontmatter fields |

## Web UI

Dashboard at `http://localhost:4100/vault`. Requires [pi-webserver](../pi-webserver).

## License

MIT
