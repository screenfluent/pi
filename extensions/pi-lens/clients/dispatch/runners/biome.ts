/**
 * Biome runner for dispatch system
 *
 * Requires: @biomejs/biome (npm install -D @biomejs/biome)
 */

import { safeSpawn } from "../../safe-spawn.js";
import { createBiomeParser } from "./utils/diagnostic-parsers.js";
import type {
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";

// Cache biome availability check
let biomeAvailable: boolean | null = null;

function isBiomeAvailable(): boolean {
	if (biomeAvailable !== null) return biomeAvailable;

	// Check if biome CLI is available (do NOT auto-install via npx)
	const check = safeSpawn("biome", ["--version"], {
		timeout: 5000,
	});
	biomeAvailable = !check.error && check.status === 0;
	return biomeAvailable;
}

const biomeRunner: RunnerDefinition = {
	id: "biome-lint",
	appliesTo: ["jsts", "json"],
	priority: 10,
	enabledByDefault: true,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		// Skip if biome is not installed
		if (!isBiomeAvailable()) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// IMPORTANT: Never use --write in dispatch runner to prevent infinite loops.
		// Writing to the file would trigger another tool_result event, which would
		// call dispatchLint again, creating a feedback loop.
		// Use /lens-format command for explicit formatting, or autofix flags on
		// the write/edit tools directly.
		const args = ["check", ctx.filePath];

		const result = safeSpawn("biome", args, {
			timeout: 30000,
		});

		const output = result.stdout + result.stderr;

		if (result.status === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		// Parse diagnostics (never autofix in dispatch to prevent loops)
		const parseBiomeOutput = createBiomeParser(false);
		const diagnostics = parseBiomeOutput(output, ctx.filePath);

		return {
			status: "failed",
			diagnostics,
			semantic: "warning",
		};
	},
};

export default biomeRunner;
