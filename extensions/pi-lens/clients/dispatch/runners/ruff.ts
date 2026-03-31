/**
 * Ruff runner for dispatch system
 *
 * Ruff handles both formatting and linting for Python files.
 * Supports venv-local installations.
 */

import { safeSpawn } from "../../safe-spawn.js";
import { stripAnsi } from "../../sanitize.js";
import { createAvailabilityChecker } from "./utils/runner-helpers.js";
import { parseRuffOutput } from "./utils/diagnostic-parsers.js";
import type {
	Diagnostic,
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";

const ruff = createAvailabilityChecker("ruff", ".exe");

const ruffRunner: RunnerDefinition = {
	id: "ruff-lint",
	appliesTo: ["python"],
	priority: 10,
	enabledByDefault: true,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		// Skip if ruff is not installed
		if (!ruff.isAvailable(ctx.cwd || process.cwd())) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// IMPORTANT: Never use --fix in dispatch runner to prevent infinite loops.
		// Writing to the file would trigger another tool_result event, which would
		// call dispatchLint again, creating a feedback loop.
		// Fixes should be applied through explicit commands or user edits.
		const args = ["check", ctx.filePath];

		const result = safeSpawn(ruff.getCommand()!, args, {
			timeout: 30000,
		});

		const raw = stripAnsi(result.stdout + result.stderr);

		if (result.status === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		// Parse diagnostics
		const diagnostics = parseRuffOutput(raw, ctx.filePath);

		return {
			status: "failed",
			diagnostics,
			semantic: "warning",
		};
	},
};

export default ruffRunner;
