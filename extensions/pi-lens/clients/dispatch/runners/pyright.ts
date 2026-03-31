/**
 * Pyright runner for dispatch system
 *
 * Provides real Python type-checking (not just linting).
 * Catches type errors like: result: str = add(1, 2)  # Type "int" not assignable to "str"
 *
 * Requires: pyright (pip install pyright or npm install -g pyright)
 */

import { safeSpawn } from "../../safe-spawn.js";
import { createAvailabilityChecker } from "./utils/runner-helpers.js";
import type {
	Diagnostic,
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";

const pyright = createAvailabilityChecker("pyright", ".exe");

const pyrightRunner: RunnerDefinition = {
	id: "pyright",
	appliesTo: ["python"],
	priority: 5, // Higher priority than ruff (10) - type errors are more important
	enabledByDefault: true,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		// Skip if pyright is not installed
		if (!pyright.isAvailable(ctx.cwd || process.cwd())) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// Run pyright with JSON output (use venv-local or global command)
		const result = safeSpawn(pyright.getCommand()!, ["--outputjson", ctx.filePath], {
			timeout: 60000,
		});

		// Pyright returns non-zero when errors found, that's OK
		if (result.error) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		const output = (result.stdout || "").trim();
		if (!output) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		try {
			const data = JSON.parse(output);
			const diagnostics = parsePyrightOutput(data, ctx.filePath);

			if (diagnostics.length === 0) {
				return { status: "succeeded", diagnostics: [], semantic: "none" };
			}

			const hasErrors = diagnostics.some((d) => d.severity === "error");

			return {
				status: hasErrors ? "failed" : "succeeded",
				diagnostics,
				semantic: hasErrors ? "blocking" : "warning",
			};
		} catch {
			// JSON parse error
			return {
				status: "failed",
				diagnostics: [],
				semantic: "none",
				rawOutput: output.slice(0, 500),
			};
		}
	},
};

function parsePyrightOutput(
	data: any,
	_filePath: string,
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	// Pyright JSON output has generalDiagnostics array
	const generalDiags = data.generalDiagnostics || [];

	for (const diag of generalDiags) {
		// Skip if not for this file (pyright may output diagnostics for imports)
		// For now, include all - caller will filter if needed

		diagnostics.push({
			id: `pyright-${diag.rule || diag.start?.line || "unknown"}`,
			message: diag.message || "Type error",
			filePath: diag.file || _filePath,
			line: diag.start?.line || 0,
			column: diag.start?.column || 0,
			severity: diag.severity === "error" ? "error" : "warning",
			semantic: diag.severity === "error" ? "blocking" : "warning",
			tool: "pyright",
			rule: diag.rule,
		});
	}

	return diagnostics;
}

export default pyrightRunner;
