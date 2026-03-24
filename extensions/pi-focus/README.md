# pi-focus

Toggle tool visibility per session using named profiles. When you switch profiles, disabled tools are completely removed from the agent's context — no descriptions, no token cost.

Generated from scratch by Claude Opus 4.6 High.

## Commands

| Command | Description |
|---------|-------------|
| `/focus` | TUI select dialog — pick a profile |
| `/focus <name>` | Switch directly to a profile |
| `/focus show` | Show active/disabled tools with names |

## Configuration

In `~/.pi/agent/settings.json` or `.pi/settings.json`:

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

### Profile rules

- `include` — whitelist (only these tools active)
- `exclude` — blacklist (all except these)
- neither — all tools active
- Patterns support trailing `*` wildcard (e.g., `calendar_*`)
- Profile `all` is always available as fallback even without configuration

### Project mapping

`projects` maps project names (from `pi-workon`) to profiles. When `pi-workon` emits a `workon:switch` event, pi-focus automatically switches to the mapped profile.

Manual `/focus` always overrides automatic switching.

## How it works

Uses `pi.setActiveTools()` which:
1. Removes tools from the agent's tool list
2. **Rebuilds the system prompt** without disabled tool descriptions
3. Disabled tools consume zero tokens — agent doesn't know they exist

## License

MIT
