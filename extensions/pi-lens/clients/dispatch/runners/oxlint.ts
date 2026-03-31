/**
 * Oxlint runner for dispatch system
 *
 * Fast Rust-based JavaScript/TypeScript linter from the Oxc project.
 * Zero-config by default, compatible with ESLint rules.
 *
 * Why oxlint?
 * - ~100x faster than ESLint (Rust-based)
 * - Zero-config (works out of the box)
 * - Growing rule set (eslint, typescript, react, unicorn, etc.)
 * - JSON output for programmatic use
 *
 * Comparison:
 * - vs Biome: Similar performance, different rule philosophy
 * - vs ESLint: Much faster, fewer rules but catching up
 *
 * Install: npm install -D oxlint
 * Or: cargo install oxlint
 *
 * Config: .oxlintrc.json (optional, zero-config works)
 */

import { safeSpawn } from "../../safe-spawn.js";
import { createAvailabilityChecker, createConfigFinder } from "./utils/runner-helpers.js";
import type {
	Diagnostic,
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";

const oxlint = createAvailabilityChecker("oxlint", ".exe");
const findOxlintConfig = createConfigFinder(".oxlintrc.json");

/**
 * Parse oxlint JSON output
 *
 * Format: Array of diagnostic objects
 * [{
 *   "ruleId": "no-unused-vars",
 *   "severity": 2,
 *   "message": "'foo' is assigned a value but never used.",
 *   "line": 10,
 *   "column": 7,
 *   "nodeType": "Identifier",
 *   "messageId": "unusedVar",
 *   "endLine": 10,
 *   "endColumn": 10,
 *   "fix": { "range": [95, 108], "text": "" }
 * }]
 */
function parseOxlintOutput(raw: string, filePath: string): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	if (!raw.trim()) {
		return diagnostics;
	}

	try {
		const parsed = JSON.parse(raw) as Array<{
			ruleId?: string;
			severity?: number; // 1 = warning, 2 = error
			message?: string;
			line?: number;
			column?: number;
			messageId?: string;
			fix?: { range: number[]; text: string };
		}>;

		if (!Array.isArray(parsed)) {
			return diagnostics;
		}

		for (const item of parsed) {
			if (!item.message || !item.line) continue;

			const severity = item.severity === 2 ? "error" : "warning";

			diagnostics.push({
				id: `oxlint-${item.line}-${item.ruleId || "unknown"}`,
				message: item.message,
				filePath,
				line: item.line,
				column: item.column || 1,
				severity,
				semantic: severity === "error" ? "blocking" : "warning",
				tool: "oxlint",
				rule: item.ruleId,
				fixable: !!item.fix,
				fixSuggestion: item.fix?.text,
			});
		}
	} catch {
		// If JSON parsing fails, try line-based parsing for CLI output
		const lines = raw.split("\n").filter((l) => l.trim());
		for (const line of lines) {
			// Try to match: file.ts:10:7: Error message [ruleId]
			const match = line.match(/^(\d+):(\d+)\s+(.+?)\s*\[(\w+)\]$/);
			if (match) {
				diagnostics.push({
					id: `oxlint-${match[1]}-${match[4]}`,
					message: `${match[4]}: ${match[3]}`,
					filePath,
					line: parseInt(match[1], 10),
					column: parseInt(match[2], 10),
					severity: "warning",
					semantic: "warning",
					tool: "oxlint",
					rule: match[4],
				});
			}
		}
	}

	return diagnostics;
}

const oxlintRunner: RunnerDefinition = {
	id: "oxlint",
	appliesTo: ["jsts"],
	priority: 12, // Between biome (10) and slop (25)
	enabledByDefault: false, // Opt-in initially - let users choose between biome/oxlint
	skipTestFiles: true, // Test files often use patterns that trigger false positives

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		// Skip if oxlint is not installed
		if (!oxlint.isAvailable(ctx.cwd || process.cwd())) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// Check if user explicitly disabled oxlint (keep biome as primary)
		if (ctx.pi.getFlag("no-oxlint")) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// Build args
		// --format json: JSON output
		// --config: Only if config file exists (zero-config otherwise)
		const args: string[] = ["--format", "json"];

		// Check for config file
		const configPath = findOxlintConfig(ctx.cwd);
		if (configPath) {
			args.push("--config", configPath);
		}

		// Add file path
		args.push(ctx.filePath);

		const result = safeSpawn(oxlint.getCommand()!, args, {
			timeout: 10000, // Fast - should complete quickly
		});

		// oxlint exits with code 1 if issues found, 0 if clean
		if (result.status === 0 && !result.stdout?.trim()) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		// Parse diagnostics
		const raw = result.stdout + result.stderr;
		const diagnostics = parseOxlintOutput(raw, ctx.filePath);

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

export default oxlintRunner;
