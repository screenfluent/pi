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
│   ├── pi-jobs/         # Agent run tracking — tokens, costs, duration, web dashboard
│   ├── pi-subagent/     # Isolated subagent subprocesses (single, parallel, chain, pool)
│   └── btw.ts           # Side conversation overlay (multi-slot, tool execution, inject/summarize)
├── skills/
│   ├── obsidian-vault/  # Vault management instructions (PARA, conventions, safety)
│   ├── pi-memory/       # Memory system usage (two-layer, when to write, hygiene)
│   ├── weekly-review/   # Structured weekly review (projects, habits, costs, planning)
│   └── handoff/         # Session context transfer prompt for continuation
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

## Subagent Orchestration

You can delegate tasks to specialized subagents via the `subagent` tool.
Each subagent runs as an isolated pi subprocess with its own context window.

### Available Agents

**planner** (user) — Creates implementation plans from context and requirements
  model: openai-codex/gpt-5.4
  tools: read, grep, find, ls
**reviewer** (user) — Code review specialist for quality and security analysis
  model: claude-opus-4-6
  tools: read, grep, find, ls, bash
**scout** (user) — Fast codebase recon that returns compressed context for handoff to other agents
  model: claude-haiku-4-5
  tools: read, grep, find, ls, bash
**worker** (user) — General-purpose subagent with full capabilities, isolated context
  model: openai-codex/gpt-5.4
**executor** (user) — Mechanical task executor. English-only, no pleasantries, output-only.
  model: openai-codex/gpt-5.4
**oracle** (user) — Knowledge verification for AI-to-AI cross-checking. Machine-readable output, no pleasantries.
  model: openai-codex/gpt-5.4

### Usage Patterns

**Single task (fast recon):**
```json
{ "agent": "scout", "task": "Map the auth module — list files, key types, entry points" }
```

**Parallel tasks (independent work):**
```json
{ "tasks": [
    { "agent": "scout", "task": "Map the API routes", "model": "claude-haiku-4-5" },
    { "agent": "scout", "task": "Map the database schema", "model": "claude-haiku-4-5" }
  ] }
```

**Chain (pipeline — each step gets prior output via {previous}):**
```json
{ "chain": [
    { "agent": "scout", "task": "Map the auth module" },
    { "agent": "planner", "task": "Plan refactoring based on: {previous}" },
    { "agent": "worker", "task": "Implement the plan: {previous}" }
  ] }
```

**Per-task overrides:** model, thinking (off/minimal/low/medium/high/xhigh), extensions, skills, noTools, noSkills

**Orchestrator (hierarchical agent tree — agents spawn and message each other):**
```json
{ "orchestrator": { "agent": "planner", "task": "Build the auth system. Spawn specialists as needed." } }
```
The root agent gets spawn_agent, send_message, kill_agent, list_agents tools.
Sub-agents also get these tools and can spawn their own children (max depth: 4).

**Pool (manual long-lived agents — persistent context across messages):**
```json
{ "action": "spawn", "id": "worker-1", "agent": "worker", "task": "Start on auth" }
{ "action": "send", "id": "worker-1", "message": "Now refactor the middleware" }
{ "action": "list" }
{ "action": "kill", "id": "worker-1" }
```

**Tips:**
- Use scout (haiku) for fast recon, planner/reviewer (sonnet) for analysis, worker for implementation
- Parallel is ideal for independent tasks — results stream back as they complete
- Chain is ideal for multi-step workflows where each step builds on the previous
- Orchestrator is ideal when the task benefits from autonomous delegation and coordination
- Pool is ideal when you want to manually manage long-lived agents with persistent context
- Extensions: subagents run with -ne (no extensions). Whitelist only what's needed.
- **Background by default:** Always spawn pool agents with `background: true` so the user conversation is never blocked. Use `poll` to check progress, `wait` to collect results when needed. Only skip background mode if the user explicitly asks to wait for the result inline.

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
- Web dashboard: `http://localhost:4100` (/cron, /tracker, /vault, /jobs)
