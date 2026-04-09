/**
 * golangci-lint runner for dispatch system
 *
 * Runs golangci-lint when a .golangci.yml config is present.
 * golangci-lint is the standard meta-linter for Go projects — it runs
 * staticcheck, errcheck, gosimple, and many others in one pass.
 *
 * Gate: skips when no .golangci.yml/.golangci.yaml config is found (project
 * relies on go-vet only). This avoids noisy default-rule runs on projects
 * that haven't opted in.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { safeSpawnAsync } from "../../safe-spawn.js";
import { stripAnsi } from "../../sanitize.js";
import { tryLazyInstall } from "./utils/lazy-installer.js";
import type {
	Diagnostic,
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";

const GOLANGCI_CONFIGS = [
	".golangci.yml",
	".golangci.yaml",
	".golangci.toml",
	".golangci.json",
];

function hasGolangciConfig(cwd: string): boolean {
	for (const cfg of GOLANGCI_CONFIGS) {
		if (fs.existsSync(path.join(cwd, cfg))) return true;
	}
	return false;
}

interface GolangciIssue {
	FromLinter: string;
	Text: string;
	Severity?: string;
	Pos: {
		Filename: string;
		Line: number;
		Column: number;
	};
}

interface GolangciOutput {
	Issues: GolangciIssue[] | null;
}

function parseGolangciJson(raw: string, filePath: string): Diagnostic[] {
	try {
		const output: GolangciOutput = JSON.parse(raw);
		if (!output.Issues) return [];

		const absFile = path.resolve(filePath);

		return output.Issues.filter(
			(issue) => path.resolve(issue.Pos.Filename) === absFile,
		).map((issue) => {
			const severity = issue.Severity === "error" ? "error" : "warning";
			return {
				id: `golangci:${issue.FromLinter}:${issue.Pos.Line}`,
				message: `${issue.FromLinter}: ${issue.Text}`,
				filePath,
				line: issue.Pos.Line,
				column: issue.Pos.Column,
				severity,
				semantic: severity === "error" ? "blocking" : "warning",
				tool: "golangci-lint",
				rule: issue.FromLinter,
			} satisfies Diagnostic;
		});
	} catch {
		return [];
	}
}

const golangciRunner: RunnerDefinition = {
	id: "golangci-lint",
	appliesTo: ["go"],
	priority: 20,
	enabledByDefault: true,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		const cwd = ctx.cwd || process.cwd();

		// Only run if project has opted in via config file
		if (!hasGolangciConfig(cwd)) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// Check availability
		const versionCheck = await safeSpawnAsync("golangci-lint", ["version"], {
			timeout: 10000,
			cwd,
		});
		if (versionCheck.error || versionCheck.status !== 0) {
			await tryLazyInstall("golangci-lint", cwd);
			const retry = await safeSpawnAsync("golangci-lint", ["version"], {
				timeout: 10000,
				cwd,
			});
			if (retry.error || retry.status !== 0) {
				return { status: "skipped", diagnostics: [], semantic: "none" };
			}
		}

		// Run on the specific file. golangci-lint accepts file paths directly.
		const result = await safeSpawnAsync(
			"golangci-lint",
			["run", "--out-format=json", ctx.filePath],
			{ timeout: 60000, cwd },
		);

		const raw = stripAnsi(result.stdout + result.stderr);

		if (result.status === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		const diagnostics = parseGolangciJson(result.stdout, ctx.filePath);

		if (diagnostics.length === 0) {
			// Non-zero exit but no parseable issues — likely a config/tool error
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		const hasErrors = diagnostics.some((d) => d.semantic === "blocking");
		return {
			status: hasErrors ? "failed" : "succeeded",
			diagnostics,
			semantic: hasErrors ? "blocking" : "warning",
		};
	},
};

export default golangciRunner;
