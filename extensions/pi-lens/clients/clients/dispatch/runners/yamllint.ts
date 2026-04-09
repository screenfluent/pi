import * as nodeFs from "node:fs";
import * as path from "node:path";
import { ensureTool } from "../../installer/index.js";
import { safeSpawn } from "../../safe-spawn.js";
import { createAvailabilityChecker } from "./utils/runner-helpers.js";
import type {
	Diagnostic,
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";

const yamllint = createAvailabilityChecker("yamllint", ".exe");

const YAMLLINT_CONFIGS = [
	".yamllint",
	".yamllint.yml",
	".yamllint.yaml",
	"pyproject.toml",
	"setup.cfg",
	"tox.ini",
];

export function hasYamllintConfig(cwd: string): boolean {
	for (const cfg of YAMLLINT_CONFIGS) {
		const cfgPath = path.join(cwd, cfg);
		if (!nodeFs.existsSync(cfgPath)) continue;
		if (cfg === "pyproject.toml") {
			try {
				const content = nodeFs.readFileSync(cfgPath, "utf-8");
				if (content.includes("[tool.yamllint]")) return true;
			} catch {}
			continue;
		}
		if (cfg === "setup.cfg" || cfg === "tox.ini") {
			try {
				const content = nodeFs.readFileSync(cfgPath, "utf-8");
				if (content.includes("[yamllint]")) return true;
			} catch {}
			continue;
		}
		return true;
	}

	// Dependency hint fallback for Python projects.
	for (const depFile of ["requirements.txt", "Pipfile", "pyproject.toml"]) {
		const depPath = path.join(cwd, depFile);
		if (!nodeFs.existsSync(depPath)) continue;
		try {
			const content = nodeFs.readFileSync(depPath, "utf-8").toLowerCase();
			if (content.includes("yamllint")) return true;
		} catch {}
	}

	return false;
}

function parseYamllintParsable(raw: string, filePath: string): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const line of raw.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const match = line.match(
			/^(.*?):(\d+):(\d+):\s*\[(error|warning)\]\s*(.*?)\s*\(([^)]+)\)\s*$/i,
		);
		if (!match) continue;

		const severity = match[4].toLowerCase() === "error" ? "error" : "warning";
		diagnostics.push({
			id: `yamllint-${match[2]}-${match[3]}-${match[6]}`,
			message: `[${match[6]}] ${match[5]}`,
			filePath,
			line: Number(match[2]),
			column: Number(match[3]),
			severity,
			semantic: severity === "error" ? "blocking" : "warning",
			tool: "yamllint",
			rule: match[6],
		});
	}
	return diagnostics;
}

const yamllintRunner: RunnerDefinition = {
	id: "yamllint",
	appliesTo: ["yaml"],
	priority: 22,
	enabledByDefault: true,
	skipTestFiles: false,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		const cwd = ctx.cwd || process.cwd();
		const hasConfig = hasYamllintConfig(cwd);
		if (!hasConfig) {
			ctx.log("yamllint: no config detected, running with default rules");
		}

		let cmd: string | null = null;
		if (yamllint.isAvailable(cwd)) {
			cmd = yamllint.getCommand(cwd);
		} else {
			const installed = await ensureTool("yamllint");
			if (!installed) {
				return { status: "skipped", diagnostics: [], semantic: "none" };
			}
			cmd = installed;
		}

		if (!cmd) return { status: "skipped", diagnostics: [], semantic: "none" };

		const result = safeSpawn(cmd, ["-f", "parsable", ctx.filePath], {
			timeout: 15000,
		});

		const diagnostics = parseYamllintParsable(
			`${result.stdout ?? ""}${result.stderr ?? ""}`,
			ctx.filePath,
		);
		if (diagnostics.length === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		const hasBlocking = diagnostics.some((d) => d.semantic === "blocking");
		return {
			status: hasBlocking ? "failed" : "succeeded",
			diagnostics,
			semantic: hasBlocking ? "blocking" : "warning",
		};
	},
};

export default yamllintRunner;
