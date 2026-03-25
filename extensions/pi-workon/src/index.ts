/**
 * pi-workon — Project context switching extension for pi.
 *
 * Provides:
 *   - workon        — Tool: switch project context (switch/status/list)
 *   - /workon       — Slash command: quick project switch
 *   - project_init  — Tool: detect stack & scaffold AGENTS.md, .pi/, td
 *
 * Configuration (settings.json under "pi-workon"):
 *   {
 *     "pi-workon": {
 *       "devDirs": ["~/Dev", "~/Work"],
 *       "aliases": {
 *         "bg": "battleground.no",
 *         "blog": "e9n.dev",
 *         "infra": "/opt/infrastructure"
 *       }
 *     }
 *   }
 *
 * Legacy "devDir" (string) is still supported.
 * Defaults to ~/Dev if nothing is configured.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWorkonTool, registerProjectInitTool, buildProjectContext } from "./tool.ts";
import { resolveSettings } from "./settings.ts";
import { resolveProject, listProjectDirs } from "./resolver.ts";
import { createLogger } from "./logger.ts";

export { getActiveProject } from "./tool.ts";
export { detectStack, type ProjectProfile } from "./detector.ts";
export { resolveProject, type ResolvedProject } from "./resolver.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	// Cache latest ctx for use in event listeners (set on session_start, updated on slash commands)
	let ctx: { ui: { setStatus: Function; notify: Function; theme: any }; cwd: string } | null = null;

	// Status bar: show current location, update on project switch
	pi.events.on("workon:switch", (data: { path: string; name: string }) => {
		ctx?.ui.setStatus("workon", ctx.ui.theme.fg("accent", `📂 ${data.name}`));
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		const settings = resolveSettings(sessionCtx.cwd);

		registerWorkonTool(pi, settings);
		registerProjectInitTool(pi, settings);

		pi.registerCommand("workon", {
			description: "Switch to a project: /workon <name|alias|path>",

			getArgumentCompletions: (prefix: string) => {
				const dirs = listProjectDirs(settings.devDirs).map((e) => e.name);
				const aliases = Object.keys(settings.aliases);
				return [...new Set([...dirs, ...aliases])]
					.filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase()))
					.map((n) => ({ value: n, label: n }));
			},

			handler: async (args, cmdCtx) => {
				const project = args?.trim();
				if (!project) {
					cmdCtx.ui.notify("Usage: /workon <project-name>", "info");
					return;
				}

				const resolution = resolveProject(project, settings.devDirs, settings.aliases);
				if ("error" in resolution) {
					cmdCtx.ui.notify(resolution.error, "error");
					return;
				}

				cmdCtx.ui.notify(`Switching to ${resolution.resolved.name}…`, "info");
				const context = await buildProjectContext(resolution.resolved.path, pi, settings);
				pi.sendUserMessage(context, { deliverAs: "followUp" });
			},
		});

		// Show cwd on startup (shortened: /home/user → ~)
		const cwd = sessionCtx.cwd.replace(/^\/home\/[^/]+/, "~");
		sessionCtx.ui.setStatus("workon", sessionCtx.ui.theme.fg("accent", `📂 ${cwd}`));

		log("init", { devDirs: settings.devDirs, aliasCount: Object.keys(settings.aliases).length });
	});
}
