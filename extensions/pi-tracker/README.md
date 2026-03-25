# pi-tracker

Extension repository tracker. Monitors external Pi extension repos for changes, AI analyzes relevance, reports on web dashboard.

Generated from scratch by Claude Opus 4.6 High.

## How it works

1. External repos cloned in `~/90-99.system/92.tracked-repos/`
2. Daily cron job fetches changes via `scripts/fetch-changes.sh`
3. AI analyzes changes using the `tracker` skill
4. Reports saved to `92.tracked-repos/reports/`
5. Dashboard at `/tracker` on pi-webserver

## Commands

| Command | Description |
|---------|-------------|
| `/tracker` | Show status — tracked repos and last check |
| `/tracker run` | Trigger analysis manually |
| `/tracker reports` | List recent reports |

## Configuration

`~/90-99.system/92.tracked-repos/tracker.json`:

```json
{
  "repos": [
    {
      "name": "espennilsen-pi",
      "url": "https://github.com/espennilsen/pi.git",
      "interests": ["extensions I use: pi-workon, pi-memory"],
      "lastCheckedCommit": "",
      "lastCheckedAt": ""
    }
  ]
}
```

## Dependencies

- **pi-cron** — daily scheduling
- **pi-webserver** — dashboard (optional)

## License

MIT
