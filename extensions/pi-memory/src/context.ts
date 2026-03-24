/**
 * pi-memory — System prompt injection.
 *
 * On `before_agent_start`, injects recent memory into the system prompt:
 *   - MEMORY.md (long-term, curated facts)
 *   - Yesterday's daily log
 *   - Today's daily log
 *
 * Also injects behavioral instructions for when to write/search memory.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as files from "./files.ts";

const MEMORY_INSTRUCTIONS = `
## Memory System

You have a two-layer persistent memory system: global and project.

### Global memory (scope: "global")
High-level work journal. Records WHAT happened, not HOW.
- Daily log: session date, time, which project, one-line summary of what was done.
  Example: "14:00–16:30 tailwindgallery — implemented auth flow, 2 commits"
- MEMORY.md: user preferences, habits, cross-project goals, people/contacts.
- Do NOT put technical details, architecture decisions, or code specifics here.

### Project memory (scope: "project")
Deep context for the current project. Records HOW and WHY.
- Daily log: detailed session notes — what was implemented, problems encountered, solutions chosen.
- MEMORY.md: architecture decisions, tech stack, conventions, domain knowledge, open questions.
- This is where technical depth belongs.

### Rules
- When a project is active (after /workon), default writes go to project scope.
- At the START of a work session, write a global daily entry: timestamp + project name + brief intent.
- At the END of a work session, write a global daily entry: duration + one-line outcome.
- During the session, write project daily entries with technical details as you go.
- When the user says "remember this" — decide scope by content: personal/cross-project → global, technical/project-specific → project.
- Use \`memory_search\` when you need to recall something from past sessions.
- Keep global entries to ONE LINE per session. Keep project entries as detailed as needed.
- For long-term MEMORY.md in either scope, organize into ## sections and keep them current.
`.trim();

export function registerMemoryContext(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event) => {
		const parts: string[] = [];

		// ── Global memory (always loaded) ────────────────
		const gltm = files.readFileOr(files.globalLongTermPath());
		if (gltm.trim()) {
			parts.push("## Global Memory (MEMORY.md)\n\n" + gltm.trim());
		}

		const yd = files.yesterdayStr();
		const gYesterday = files.readFileOr(files.globalDailyPath(yd));
		if (gYesterday.trim()) {
			parts.push(`## Global Yesterday (${yd})\n\n` + gYesterday.trim());
		}

		const td = files.todayStr();
		const gToday = files.readFileOr(files.globalDailyPath(td));
		if (gToday.trim()) {
			parts.push(`## Global Today (${td})\n\n` + gToday.trim());
		}

		// ── Project memory (loaded when workon is active) ─
		const pltmPath = files.projectLongTermPath();
		if (pltmPath) {
			const pltm = files.readFileOr(pltmPath);
			if (pltm.trim()) {
				parts.push("## Project Memory (MEMORY.md)\n\n" + pltm.trim());
			}

			const pYesterday = files.readFileOr(files.projectDailyPath(yd) ?? "");
			if (pYesterday.trim()) {
				parts.push(`## Project Yesterday (${yd})\n\n` + pYesterday.trim());
			}

			const pToday = files.readFileOr(files.projectDailyPath(td) ?? "");
			if (pToday.trim()) {
				parts.push(`## Project Today (${td})\n\n` + pToday.trim());
			}
		}

		const memoryBlock = parts.length > 0
			? "\n\nCurrent memory:\n\n# 🧠 Memory\n\n" + parts.join("\n\n---\n\n")
			: "";

		return {
			systemPrompt:
				event.systemPrompt +
				"\n\n---\n\n" +
				MEMORY_INSTRUCTIONS +
				memoryBlock,
		};
	});
}
