/**
 * RuboCop runner for dispatch system
 *
 * Runs rubocop in lint-only mode (no auto-correct) on Ruby files.
 * Auto-correct is handled by the formatter pipeline — this runner
 * only reports remaining offenses after formatting.
 *
 * Supports bundle exec (preferred in Bundler projects).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { safeSpawnAsync } from "../../safe-spawn.js";
import { tryLazyInstall } from "./utils/lazy-installer.js";
import type {
	Diagnostic,
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";

function findRubocop(cwd: string): { cmd: string; args: string[] } {
	// Prefer bundle exec if Gemfile exists
	const gemfile = path.join(cwd, "Gemfile");
	if (fs.existsSync(gemfile)) {
		try {
			const content = fs.readFileSync(gemfile, "utf-8");
			if (content.includes("rubocop")) {
				return { cmd: "bundle", args: ["exec", "rubocop"] };
			}
		} catch {}
	}
	return { cmd: "rubocop", args: [] };
}

interface RubocopOffense {
	severity: string;
	message: string;
	cop_name: string;
	correctable: boolean;
	location: {
		line: number;
		column: number;
	};
}

interface RubocopFile {
	path: string;
	offenses: RubocopOffense[];
}

interface RubocopOutput {
	files: RubocopFile[];
}

const SEVERITY_MAP: Record<string, "error" | "warning" | "info"> = {
	fatal: "error",
	error: "error",
	warning: "warning",
	convention: "warning",
	refactor: "info",
};

function parseRubocopJson(raw: string, filePath: string): Diagnostic[] {
	try {
		const output: RubocopOutput = JSON.parse(raw);
		const diagnostics: Diagnostic[] = [];

		for (const file of output.files) {
			for (const offense of file.offenses) {
				const severity = SEVERITY_MAP[offense.severity] ?? "warning";
				diagnostics.push({
					id: `rubocop:${offense.cop_name}:${offense.location.line}`,
					message: `${offense.cop_name}: ${offense.message}`,
					filePath,
					line: offense.location.line,
					column: offense.location.column,
					severity,
					semantic: severity === "error" ? "blocking" : "warning",
					tool: "rubocop",
					rule: offense.cop_name,
					fixable: offense.correctable,
				});
			}
		}

		return diagnostics;
	} catch {
		return [];
	}
}

const rubocopRunner: RunnerDefinition = {
	id: "rubocop",
	appliesTo: ["ruby"],
	priority: 10,
	enabledByDefault: true,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		const cwd = ctx.cwd || process.cwd();
		const { cmd, args } = findRubocop(cwd);

		// Check availability
		const versionCheck = await safeSpawnAsync(cmd, [...args, "--version"], {
			timeout: 10000,
			cwd,
		});
		if (versionCheck.error || versionCheck.status !== 0) {
			await tryLazyInstall("rubocop", cwd);
			const retry = await safeSpawnAsync(cmd, [...args, "--version"], {
				timeout: 10000,
				cwd,
			});
			if (retry.error || retry.status !== 0) {
				return { status: "skipped", diagnostics: [], semantic: "none" };
			}
		}

		// Lint only — no auto-correct (formatter handles that)
		const result = await safeSpawnAsync(
			cmd,
			[...args, "--format", "json", "--no-color", ctx.filePath],
			{ timeout: 30000, cwd },
		);

		// rubocop exits 0 = no offenses, 1 = offenses found, 2 = fatal error
		if (result.status === 2) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		if (result.status === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		const diagnostics = parseRubocopJson(result.stdout, ctx.filePath);
		if (diagnostics.length === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		const hasErrors = diagnostics.some((d) => d.semantic === "blocking");
		return {
			status: hasErrors ? "failed" : "succeeded",
			diagnostics,
			semantic: hasErrors ? "blocking" : "warning",
		};
	},
};

export default rubocopRunner;
