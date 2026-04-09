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

const sqlfluff = createAvailabilityChecker("sqlfluff", ".exe");

const SQLFLUFF_CONFIGS = [".sqlfluff", "pyproject.toml", "setup.cfg", "tox.ini"];

export function hasSqlfluffConfig(cwd: string): boolean {
	for (const cfg of SQLFLUFF_CONFIGS) {
		const cfgPath = path.join(cwd, cfg);
		if (!nodeFs.existsSync(cfgPath)) continue;
		if (cfg === "pyproject.toml") {
			try {
				const content = nodeFs.readFileSync(cfgPath, "utf-8");
				if (content.includes("[tool.sqlfluff]")) return true;
			} catch {}
			continue;
		}
		if (cfg === "setup.cfg" || cfg === "tox.ini") {
			try {
				const content = nodeFs.readFileSync(cfgPath, "utf-8");
				if (content.includes("[sqlfluff]")) return true;
			} catch {}
			continue;
		}
		return true;
	}

	for (const depFile of ["requirements.txt", "Pipfile", "pyproject.toml"]) {
		const depPath = path.join(cwd, depFile);
		if (!nodeFs.existsSync(depPath)) continue;
		try {
			const content = nodeFs.readFileSync(depPath, "utf-8").toLowerCase();
			if (content.includes("sqlfluff")) return true;
		} catch {}
	}

	return false;
}

type SqlfluffJson = Array<{
	filepath?: string;
	violations?: Array<{
		code?: string;
		description?: string;
		line_no?: number;
		line_pos?: number;
	}>;
}>;

function parseSqlfluffOutput(raw: string, filePath: string): Diagnostic[] {
	if (!raw.trim()) return [];
	try {
		const parsed = JSON.parse(raw) as SqlfluffJson;
		if (!Array.isArray(parsed)) return [];

		const diagnostics: Diagnostic[] = [];
		for (const item of parsed) {
			for (const v of item.violations ?? []) {
				if (!v.description) continue;
				const code = v.code ?? "SQL";
				diagnostics.push({
					id: `sqlfluff-${v.line_no ?? 1}-${v.line_pos ?? 1}-${code}`,
					message: `[${code}] ${v.description}`,
					filePath,
					line: v.line_no ?? 1,
					column: v.line_pos ?? 1,
					severity: "warning",
					semantic: "warning",
					tool: "sqlfluff",
					rule: code,
				});
			}
		}
		return diagnostics;
	} catch {
		return [];
	}
}

const sqlfluffRunner: RunnerDefinition = {
	id: "sqlfluff",
	appliesTo: ["sql"],
	priority: 24,
	enabledByDefault: true,
	skipTestFiles: false,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		const cwd = ctx.cwd || process.cwd();
		const hasConfig = hasSqlfluffConfig(cwd);
		if (!hasConfig) {
			ctx.log("sqlfluff: no config detected, using ANSI dialect defaults");
		}

		let cmd: string | null = null;
		if (sqlfluff.isAvailable(cwd)) {
			cmd = sqlfluff.getCommand(cwd);
		} else {
			const installed = await ensureTool("sqlfluff");
			if (!installed) {
				return { status: "skipped", diagnostics: [], semantic: "none" };
			}
			cmd = installed;
		}

		if (!cmd) return { status: "skipped", diagnostics: [], semantic: "none" };

		const args = ["lint", "--format", "json", ctx.filePath];
		if (!hasConfig) {
			args.splice(2, 0, "--dialect", "ansi");
		}

		const result = safeSpawn(cmd, args, {
			timeout: 20000,
		});

		const diagnostics = parseSqlfluffOutput(result.stdout ?? "", ctx.filePath);
		if (diagnostics.length === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		return {
			status: "failed",
			diagnostics,
			semantic: "warning",
		};
	},
};

export default sqlfluffRunner;
