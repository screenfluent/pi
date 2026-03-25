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
import { expandHome } from "./settings.ts";

export { getActiveProject } from "./tool.ts";
export { detectStack, type ProjectProfile } from "./detector.ts";
export { resolveProject, type ResolvedProject } from "./resolver.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let lastCtx: any = null;

	const shortPath = (p: string) => p.replace(/^\/home\/[^/]+/, "~");

	// Update status bar on project switch — registered once, outside session_start
	pi.events.on("workon:switch", (data: { path: string; name: string }) => {
		if (lastCtx) {
			lastCtx.ui.setStatus("workon", lastCtx.ui.theme.fg("accent", `📂 ${data.name}`));
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		const settings = resolveSettings(ctx.cwd);

		// Register tools
		registerWorkonTool(pi, settings);
		registerProjectInitTool(pi, settings);

		// Register /workon slash command for quick switching
		pi.registerCommand("workon", {
			description: "Switch to a project: /workon <name|alias|path>",
			getArgumentCompletions: (prefix: string) => {
				const entries = listProjectDirs(settings.devDirs);
				const names = entries.map((e) => e.name);

				// Include aliases
				const aliasNames = Object.keys(settings.aliases);
				const all = [...new Set([...names, ...aliasNames])];

				return all
					.filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase()))
					.map((n) => ({ value: n, label: n }));
			},
			handler: async (args, ctx) => {
				const project = args?.trim();
				if (!project) {
					ctx.ui.notify("Usage: /workon <project-name>", "info");
					return;
				}

				const settings = resolveSettings(ctx.cwd);
				const resolution = resolveProject(project, settings.devDirs, settings.aliases);
				if ("error" in resolution) {
					ctx.ui.notify(resolution.error, "error");
					return;
				}

				const projectPath = resolution.resolved.path;
				ctx.ui.notify(`Switching to ${resolution.resolved.name}…`, "info");

				// Build context and inject as system message
				const context = await buildProjectContext(projectPath, pi, settings);
				pi.sendUserMessage(context, { deliverAs: "followUp" });
			},
		});

		// Show current directory in status bar on start
		ctx.ui.setStatus("workon", ctx.ui.theme.fg("accent", `📂 ${shortPath(ctx.cwd)}`));

		log("init", { devDirs: settings.devDirs, aliasCount: Object.keys(settings.aliases).length });
	});
}
