/**
 * Oxlint runner for dispatch system
 *
 * Fast JavaScript/TypeScript linter written in Rust.
 * Drop-in replacement for ESLint with better performance.
 *
 * Requires: oxlint (npm install -g oxlint)
 */

import { safeSpawnAsync } from "../../safe-spawn.ts";
import type {
	Diagnostic,
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.ts";
import { createAvailabilityChecker } from "./utils/runner-helpers.ts";

const oxlint = createAvailabilityChecker("oxlint", ".exe");

const oxlintRunner: RunnerDefinition = {
	id: "oxlint",
	appliesTo: ["jsts"],
	priority: 12,
	enabledByDefault: false, // Opt-in: may conflict with ESLint in existing projects
	skipTestFiles: true,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		const cwd = ctx.cwd || process.cwd();

		// Check if oxlint is available
		if (!oxlint.isAvailable(cwd)) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// Run oxlint on the file
		const result = await safeSpawnAsync(
			oxlint.getCommand(cwd)!,
			["--format", "unix", ctx.filePath],
			{
				timeout: 30000,
			},
		);

		// Oxlint returns non-zero when issues found
		if (result.status === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		// Parse Unix format output: file:line:column: message (rule)
		const diagnostics = parseOxlintOutput(
			result.stdout + result.stderr,
			ctx.filePath,
		);

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

function parseOxlintOutput(raw: string, filePath: string): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const lines = raw.split("\n");

	for (const line of lines) {
		// Parse: file:line:column: message (rule)
		// Example: src/main.ts:10:5: Unexpected console statement (no-console)
		const match = line.match(/^(.+):(\d+):(\d+):\s*(.+?)\s*\(([^)]+)\)$/);
		if (match) {
			const [, _file, lineStr, _col, message, rule] = match;
			diagnostics.push({
				id: `oxlint-${rule}-${lineStr}`,
				message: `${message} (${rule})`,
				filePath,
				line: parseInt(lineStr, 10),
				severity: "warning",
				semantic: "warning",
				tool: "oxlint",
				rule,
			});
		}
	}

	return diagnostics;
}

export default oxlintRunner;
