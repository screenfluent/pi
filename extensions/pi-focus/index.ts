/**
 * pi-focus — Toggle tool visibility per session using named profiles.
 *
 * Usage:
 *   /focus           → TUI select dialog
 *   /focus coding    → switch directly
 *   /focus show      → show active/disabled tools
 *
 * Settings (in ~/.pi/agent/settings.json or .pi/settings.json):
 *   {
 *     "pi-focus": {
 *       "profiles": {
 *         "coding": {
 *           "description": "Only dev tools",
 *           "exclude": ["calendar_*", "crm_*", "finance_*"]
 *         },
 *         "life": {
 *           "description": "Life management",
 *           "include": ["calendar_*", "crm_*", "finance_*", "memory_*", "read", "bash", "write", "edit"]
 *         },
 *         "all": {
 *           "description": "Everything enabled"
 *         }
 *       }
 *     }
 *   }
 *
 * Profile rules:
 *   - "include" → only these tools are active (whitelist)
 *   - "exclude" → all tools active except these (blacklist)
 *   - neither   → all tools active
 *   - Patterns support trailing * wildcard (e.g., "calendar_*")
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── Types ───────────────────────────────────────────────────────

interface FocusProfile {
	description?: string;
	include?: string[];
	exclude?: string[];
}

interface FocusSettings {
	profiles: Record<string, FocusProfile>;
	projects: Record<string, string>;
}

// ── Helpers ─────────────────────────────────────────────────────

function matchesPattern(name: string, pattern: string): boolean {
	if (pattern.endsWith("*")) {
		return name.startsWith(pattern.slice(0, -1));
	}
	return name === pattern;
}

function matchesAny(name: string, patterns: string[]): boolean {
	return patterns.some((p) => matchesPattern(name, p));
}

function applyProfile(allToolNames: string[], profile: FocusProfile): string[] {
	if (profile.include) {
		return allToolNames.filter((name) => matchesAny(name, profile.include!));
	}
	if (profile.exclude) {
		return allToolNames.filter((name) => !matchesAny(name, profile.exclude!));
	}
	return allToolNames;
}

function readJsonSafe(filePath: string): Record<string, unknown> {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return {};
	}
}

function loadSettings(cwd: string): FocusSettings {
	const globalPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
	const projectPath = path.join(cwd, ".pi", "settings.json");

	const globalRaw = readJsonSafe(globalPath)["pi-focus"] as Record<string, unknown> | undefined;
	const projectRaw = readJsonSafe(projectPath)["pi-focus"] as Record<string, unknown> | undefined;

	const merged = { ...(globalRaw ?? {}), ...(projectRaw ?? {}) };
	const profiles = (merged.profiles ?? {}) as Record<string, FocusProfile>;

	// Always have "all" as a fallback
	if (!profiles["all"]) {
		profiles["all"] = { description: "Everything enabled" };
	}

	const projects = (merged.projects ?? {}) as Record<string, string>;

	return { profiles, projects };
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let currentProfile: string | null = null;
	let cachedCwd: string | null = null;

	pi.registerCommand("focus", {
		description: "Switch tool focus profile: /focus [profile|show]",

		getArgumentCompletions: (prefix: string) => {
			const settings = loadSettings(cachedCwd ?? process.cwd());
			const names = [...Object.keys(settings.profiles), "show"];
			return names
				.filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase()))
				.map((n) => ({ value: n, label: n }));
		},

		handler: async (args, ctx) => {
			cachedCwd = ctx.cwd;
			const settings = loadSettings(ctx.cwd);
			const profileNames = Object.keys(settings.profiles);

			if (profileNames.length === 0) {
				ctx.ui.notify('No profiles configured. Add "pi-focus.profiles" to settings.json.', "warning");
				return;
			}

			const arg = args?.trim().toLowerCase();

			// ── /focus show ──────────────────────────────────
			if (arg === "show") {
				const all = pi.getAllTools();
				const active = new Set(pi.getActiveTools());

				const enabled = all.filter((t) => active.has(t.name));
				const disabled = all.filter((t) => !active.has(t.name));

				const lines: string[] = [];
				lines.push(`Profile: ${currentProfile ?? "(none)"}`);
				lines.push(`Active: ${enabled.length}  Disabled: ${disabled.length}`);
				lines.push("");
				lines.push("Active tools:");
				for (const t of enabled) {
					lines.push(`  ✓ ${t.name}`);
				}
				if (disabled.length > 0) {
					lines.push("");
					lines.push("Disabled tools:");
					for (const t of disabled) {
						lines.push(`  ✗ ${t.name}`);
					}
				}

				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			// ── Resolve profile name ─────────────────────────
			let profileName: string | undefined;

			if (arg && arg !== "") {
				// Direct argument
				profileName = profileNames.find((n) => n.toLowerCase() === arg);
				if (!profileName) {
					ctx.ui.notify(
						`Unknown profile "${arg}". Available: ${profileNames.join(", ")}`,
						"error",
					);
					return;
				}
			} else {
				// TUI select
				const options = profileNames.map((name) => {
					const p = settings.profiles[name];
					const desc = p.description ? ` — ${p.description}` : "";
					const marker = name === currentProfile ? " ◀" : "";
					return `${name}${desc}${marker}`;
				});

				const choice = await ctx.ui.select("Focus profile:", options);
				if (choice === undefined) return; // cancelled

				profileName = profileNames[options.indexOf(choice)];
			}

			if (!profileName) return;

			// ── Apply profile ────────────────────────────────
			const profile = settings.profiles[profileName];
			const allTools = pi.getAllTools();
			const allNames = allTools.map((t) => t.name);
			const activeNames = applyProfile(allNames, profile);

			pi.setActiveTools(activeNames);
			currentProfile = profileName;

			const disabled = allNames.length - activeNames.length;
			const msg = disabled > 0
				? `🎯 Focus: ${profileName} (${activeNames.length} active, ${disabled} disabled)`
				: `🎯 Focus: ${profileName} (all ${activeNames.length} tools active)`;

			ctx.ui.notify(msg, "info");

			// Show in status bar
			if (profileName === "all" || disabled === 0) {
				ctx.ui.setStatus("pi-focus", undefined);
			} else {
				ctx.ui.setStatus(
					"pi-focus",
					ctx.ui.theme.fg("accent", `🎯 ${profileName}`),
				);
			}
		},
	});

	// ── Helper: apply a profile by name ─────────────────────────
	function switchProfile(profileName: string, allToolNames: string[], profile: FocusProfile): void {
		const activeNames = applyProfile(allToolNames, profile);
		pi.setActiveTools(activeNames);
		currentProfile = profileName;
	}

	// Cache cwd on session start
	pi.on("session_start", async (_event, ctx) => {
		cachedCwd = ctx.cwd;
	});

	// Auto-switch profile when pi-workon changes project
	pi.events.on("workon:switch", (data: { path: string; name: string }) => {
		const settings = loadSettings(cachedCwd ?? process.cwd());
		const projectName = data.name.toLowerCase();

		// Check project → profile mapping
		const profileName = Object.entries(settings.projects).find(
			([key]) => key.toLowerCase() === projectName,
		)?.[1];

		if (!profileName || !settings.profiles[profileName]) return;

		const allTools = pi.getAllTools();
		const allNames = allTools.map((t) => t.name);
		switchProfile(profileName, allNames, settings.profiles[profileName]);
	});
}
