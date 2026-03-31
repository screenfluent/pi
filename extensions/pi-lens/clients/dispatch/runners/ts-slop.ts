/**
 * TypeScript Slop runner for dispatch system
 *
 * Detects "slop" patterns in TypeScript/JavaScript code:
 * - Verbose patterns (ceremony that adds no value)
 * - Defensive over-checking (excessive guards)
 * - Manual reimplementation of builtins
 * - Unnecessary object allocations
 *
 * Based on slop-code-bench patterns adapted for TypeScript
 */

import { spawnSync } from "node:child_process";
import { safeSpawn } from "../../safe-spawn.js";
import {
	createConfigFinder,
	isSgAvailable,
} from "./utils/runner-helpers.js";
import type {
	Diagnostic,
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";

const findSlopConfig = createConfigFinder("ts-slop-rules");

const tsSlopRunner: RunnerDefinition = {
	id: "ts-slop",
	// NOTE: TypeScript/JavaScript slop detection is now handled by ast-grep-napi
	// This CLI runner is kept as fallback for edge cases but disabled by default
	appliesTo: [], // Disabled - use ast-grep-napi instead
	priority: 20,
	enabledByDefault: false,
	skipTestFiles: true,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		// Check if ast-grep is available
		if (!isSgAvailable()) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// Find slop config
		const configPath = findSlopConfig(ctx.cwd);
		if (!configPath) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// Run ast-grep scan
		const args = ["sg", "scan", "--config", configPath, "--json", ctx.filePath];

		const result = safeSpawn("npx", args, {
			timeout: 30000,
		});

		const raw = result.stdout + result.stderr;

		if (result.status === 0 && !raw.trim()) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		// Parse results
		const diagnostics = parseSlopOutput(raw, ctx.filePath);

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

function parseSlopOutput(raw: string, filePath: string): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			for (const item of parsed) {
				const line = item.range?.start?.line || 1;
				const ruleId = item.rule || "unknown";
				const message = item.message || "";

				// Categorize by severity based on weight from metadata
				const weight = item.metadata?.weight || 3;
				const severity = weight >= 4 ? "error" : "warning";
				const category = item.metadata?.category || "slop";

				// Add slop category indicator to message
				let enhancedMessage = `[${category}] ${message}`;
				if (item.replacement) {
					const preview =
						item.replacement.length > 40
							? `${item.replacement.substring(0, 40)}...`
							: item.replacement;
					enhancedMessage += `\n💡 Suggested fix: → "${preview}"`;
				}

				diagnostics.push({
					id: `ts-slop-${line}-${ruleId}`,
					message: enhancedMessage,
					filePath,
					line,
					column: item.range?.start?.column || 0,
					severity,
					semantic: severity === "error" ? "blocking" : "warning",
					tool: "ts-slop",
					rule: ruleId,
					fixable: !!item.replacement,
					fixSuggestion: item.replacement,
				});
			}
		}
	} catch {
		// JSON parse failed, try line-by-line
		const lines = raw.split("\n");
		for (const line of lines) {
			if (line.includes(":") && line.includes("L")) {
				const match = line.match(/L(\d+):?\s*(.+)/);
				if (match) {
					diagnostics.push({
						id: `ts-slop-${match[1]}-line`,
						message: `[slop] ${match[2].trim()}`,
						filePath,
						line: parseInt(match[1], 10),
						severity: "warning",
						semantic: "warning",
						tool: "ts-slop",
					});
				}
			}
		}
	}

	return diagnostics;
}

export default tsSlopRunner;
