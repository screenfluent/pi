# pi-honcho-memory

Persistent memory extension for [pi](https://github.com/badlogic/pi-mono) using [Honcho](https://honcho.dev). Adapted from [agneym/pi-honcho-memory](https://github.com/agneym/pi-honcho-memory).

## How it works

1. **After each turn** — user/assistant messages are sent to Honcho
2. **Honcho learns** — builds a user profile and session summary from conversation history
3. **Before each turn** — cached profile + summary injected into system prompt (zero latency)

## Tools

| Tool | Description |
|------|-------------|
| `honcho_search` | Search persistent memory for prior conversations and decisions |
| `honcho_chat` | Ask Honcho to reason over memory — deeper questions about patterns and history |
| `honcho_remember` | Save a durable fact, preference, or decision |

## Commands

| Command | Description |
|---------|-------------|
| `/honcho-status` | Show connection status and config |
| `/honcho-setup` | Interactive configuration wizard |

## Configuration

Config is read from `~/.honcho/config.json`:

```json
{
  "apiKey": "your-key-or-placeholder",
  "hosts": {
    "pi": {
      "endpoint": "http://localhost:8000",
      "workspace": "pi",
      "aiPeer": "pi",
      "sessionStrategy": "repo"
    }
  }
}
```

Session strategies: `repo` (share across worktrees), `git-branch` (per branch), `directory` (per cwd).

## Changes from upstream

- Import paths changed from `.js` to `.ts` (Pi loads TypeScript directly, no build step)
- Added `workon:switch` listener — re-bootstraps Honcho session when project changes via pi-workon

## Dependencies

- `@honcho-ai/sdk` — installed via `npm install` in this directory
