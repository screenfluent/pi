/**
 * pi-tracker — Extension repository tracker.
 *
 * Tracks external repos (cloned in ~/90-99.system/92.tracked-repos/),
 * runs daily via pi-cron, AI analyzes changes, reports on web dashboard.
 *
 * Provides:
 *   - cron job "tracker-daily" — daily fetch + analysis
 *   - /tracker command — manual trigger or status
 *   - web dashboard at /tracker via pi-webserver
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function resolveTrackerPaths() {
	const home = os.homedir();
	const reposDir = path.join(home, "90-99.system", "92.tracked-repos");
	const configPath = path.join(reposDir, "tracker.json");
	const reportsDir = path.join(reposDir, "reports");
	const extensionDir = path.join(home, "90-99.system", "91.pi-home", "extensions", "pi-tracker");
	return { reposDir, configPath, reportsDir, extensionDir };
}

export default function (pi: ExtensionAPI) {
	const paths = resolveTrackerPaths();

	// ── Register cron job on session start ─────────────────
	pi.on("session_start", async () => {
		// Register tracker-daily cron job (daily at 08:00)
		pi.events.emit("cron:add", {
			name: "tracker-daily",
			schedule: "0 8 * * *",
			prompt: "/skill:tracker",
			enabled: true,
			// Don't duplicate if already exists
			skipIfExists: true,
		});
	});

	// ── /tracker command ───────────────────────────────────
	pi.registerCommand("tracker", {
		description: "Extension tracker: /tracker [run|status|reports]",
		handler: async (args, ctx) => {
			const cmd = args?.trim().toLowerCase() || "status";

			if (cmd === "run") {
				ctx.ui.notify("🔍 Running tracker analysis...", "info");
				pi.sendUserMessage("/skill:tracker", { deliverAs: "followUp" });
				return;
			}

			if (cmd === "reports") {
				if (!fs.existsSync(paths.reportsDir)) {
					ctx.ui.notify("No reports yet. Run /tracker run first.", "info");
					return;
				}
				const files = fs.readdirSync(paths.reportsDir)
					.filter(f => f.endsWith(".md"))
					.sort()
					.reverse()
					.slice(0, 10);
				if (files.length === 0) {
					ctx.ui.notify("No reports yet.", "info");
					return;
				}
				ctx.ui.notify("Recent reports:\n" + files.map(f => `  📄 ${f}`).join("\n"), "info");
				return;
			}

			// status
			if (!fs.existsSync(paths.configPath)) {
				ctx.ui.notify("Tracker not configured. Missing tracker.json", "warning");
				return;
			}
			const config = JSON.parse(fs.readFileSync(paths.configPath, "utf-8"));
			const lines = [`Tracking ${config.repos.length} repos:`];
			for (const repo of config.repos) {
				const checked = repo.lastCheckedCommit ? repo.lastCheckedCommit.slice(0, 7) : "never";
				lines.push(`  📦 ${repo.name} (last: ${checked})`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ── Mount web dashboard ────────────────────────────────
	const mountDashboard = () => {
		pi.events.emit("web:mount", {
			name: "tracker",
			prefix: "/tracker",
			handler: (_req: any, res: any) => {
				const htmlPath = path.join(paths.extensionDir, "src", "tracker.html");
				if (fs.existsSync(htmlPath)) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(fs.readFileSync(htmlPath, "utf-8"));
				} else {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end("<h1>Tracker</h1><p>Dashboard loading...</p>");
				}
			},
		});

		pi.events.emit("web:mount-api", {
			name: "tracker-api",
			prefix: "/tracker",
			handler: (req: any, res: any) => {
				res.writeHead(200, { "Content-Type": "application/json" });

				// Serve reports list and content
				if (req.url?.includes("/reports")) {
					if (!fs.existsSync(paths.reportsDir)) {
						res.end(JSON.stringify([]));
						return;
					}
					const files = fs.readdirSync(paths.reportsDir)
						.filter((f: string) => f.endsWith(".md"))
						.sort()
						.reverse();

					const reports = files.map((f: string) => ({
						date: f.replace(".md", ""),
						content: fs.readFileSync(path.join(paths.reportsDir, f), "utf-8"),
					}));
					res.end(JSON.stringify(reports));
					return;
				}

				// Serve config/status
				if (!fs.existsSync(paths.configPath)) {
					res.end(JSON.stringify({ repos: [] }));
					return;
				}
				const config = JSON.parse(fs.readFileSync(paths.configPath, "utf-8"));
				res.end(JSON.stringify(config));
			},
		});
	};

	pi.events.on("web:ready", mountDashboard);

	pi.on("session_shutdown", async () => {
		pi.events.emit("web:unmount", { name: "tracker" });
		pi.events.emit("web:unmount-api", { name: "tracker-api" });
	});
}
