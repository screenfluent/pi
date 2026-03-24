# Pi Agent Home

Personal Pi agent configuration. Extensions, skills, and settings live here.

## Directory Layout

```
├── extensions/      # Pi extensions
├── skills/          # Custom skills
├── themes/          # TUI themes
├── settings.json    # Global settings
└── AGENTS.md        # This file
```

## Conventions

- Extensions communicate via `pi.events` (event bus), never direct imports
- Settings use `pi-<name>` keys in settings.json
- Tools return structured text for LLM consumption
