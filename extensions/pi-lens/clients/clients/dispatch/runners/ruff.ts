/**
 * Ruff runner for dispatch system
 *
 * Ruff handles both formatting and linting for Python files.
 * Supports venv-local installations.
 */

import { ensureTool } from "../../installer/index.js";
import { safeSpawnAsync } from "../../safe-spawn.js";
import { stripAnsi } from "../../sanitize.js";
import type {
	Diagnostic,
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";
import { parseRuffOutput } from "./utils/diagnostic-parsers.js";
import { createAvailabilityChecker } from "./utils/runner-helpers.js";

const ruff = createAvailabilityChecker("ruff", ".exe");

function parseRuffJson(raw: string, filePath: string): Diagnostic[] {
	try {
		const parsed = JSON.parse(raw) as Array<{
			code?: string;
			message?: string;
			filename?: string;
			location?: { row?: number; column?: number };
			severity?: string;
			fix?: unknown;
		}>;
		if (!Array.isArray(parsed)) return [];

		return parsed.map((item, index) => {
			const severity = item.severity === "error" ? "error" : "warning";
			const code = item.code || "ruff";
			return {
				id: `ruff-${code}-${item.location?.row ?? index + 1}`,
				message: item.message || code,
				filePath: item.filename || filePath,
				line: item.location?.row ?? 1,
				column: item.location?.column ?? 1,
				severity,
				semantic: severity === "error" ? "blocking" : "warning",
				tool: "ruff",
				rule: code,
				fixable: Boolean(item.fix),
			};
		});
	} catch {
		return [];
	}
}

const ruffRunner: RunnerDefinition = {
	id: "ruff-lint",
	appliesTo: ["python"],
	priority: 10,
	enabledByDefault: true,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		const cwd = ctx.cwd || process.cwd();
		let cmd: string | null = null;

		// Auto-install ruff if not available (it's one of the 4 auto-install tools)
		if (ruff.isAvailable(cwd)) {
			cmd = ruff.getCommand(cwd);
		} else {
			const installed = await ensureTool("ruff");
			if (!installed) {
				return { status: "skipped", diagnostics: [], semantic: "none" };
			}
			cmd = installed;
		}

		if (!cmd) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// No --fix here: dispatch runners report issues for agent understanding,
		// not silent correction. Auto-fix (ruff --fix) already runs in the
		// format phase before dispatch, handling all safe style transforms.
		// Silently rewriting here would leave the agent's context window stale.
		const args = ["check", "--output-format", "json", ctx.filePath];

		const result = await safeSpawnAsync(cmd, args, {
			timeout: 30000,
		});

		const raw = stripAnsi(result.stdout + result.stderr);
		const diagnostics = parseRuffJson(result.stdout || "", ctx.filePath);
		const parsedDiagnostics =
			diagnostics.length > 0 ? diagnostics : parseRuffOutput(raw, ctx.filePath);

		if (result.status === 0 && parsedDiagnostics.length === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		if (parsedDiagnostics.length === 0) {
			return {
				status: "failed",
				diagnostics: [],
				semantic: "warning",
				rawOutput: raw.slice(0, 500),
			};
		}

		const hasErrors = parsedDiagnostics.some((d) => d.severity === "error");

		return {
			status: hasErrors ? "failed" : "succeeded",
			diagnostics: parsedDiagnostics,
			semantic: hasErrors ? "blocking" : "warning",
		};
	},
};

export default ruffRunner;
