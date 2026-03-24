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

You have a persistent memory system. At the start of each session, your long-term memory (MEMORY.md) and recent daily logs are loaded automatically.

**Rules:**
- When you learn something important (preferences, decisions, facts), use \`memory_write\` with target \`long_term\` to store it.
- When the user says "remember this" or similar, always write it to memory.
- Use \`memory_write\` with target \`daily\` for session notes and running context.
- Use \`memory_search\` when you need to recall something from past sessions.
- Proactively save important context at the end of significant work sessions.
- Keep daily entries concise: what was done, key decisions, blockers, next steps.
- For long-term memory, organize into sections and keep them up to date.
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
