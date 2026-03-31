/**
 * Tool execution plan for pi-lens
 *
 * Defines which tools run for each file kind and in what order.
 * This is the declarative alternative to the if/else chains in index.ts.
 *
 * Modes:
 * - "all": Run all runners in the group
 * - "fallback": Run first available runner
 * - "first-success": Run until one succeeds
 */

import type { FileKind } from "../file-kinds.js";
import type { ToolPlan } from "./types.js";

/**
 * Tool plans organized by purpose
 */
export const TOOL_PLANS: Record<string, ToolPlan> = {
	/**
	 * Linting tools for JS/TS files
	 */
	jsts: {
		name: "JavaScript/TypeScript Linting",
		groups: [
			// TypeScript LSP always runs first - blocks on errors
			{ mode: "all", runnerIds: ["ts-lsp"], filterKinds: ["jsts"] },
			// Then biome or oxlint for fast linting (user preference)
			{ mode: "fallback", runnerIds: ["biome-lint", "oxlint"] },
			// Fast structural analysis via NAPI (weight >= 4 is blocking)
			{ mode: "all", runnerIds: ["ast-grep-napi"] },
			// Type safety checks
			{ mode: "fallback", runnerIds: ["type-safety"] },
			// Comprehensive structural analysis via CLI (severity: error is blocking)
			{ mode: "fallback", runnerIds: ["ast-grep"] },
			// Architectural rules
			{ mode: "fallback", runnerIds: ["architect"] },
		],
	},

	/**
	 * Python linting tools
	 */
	python: {
		name: "Python Linting",
		groups: [
			// Ruff handles both formatting and linting
			{ mode: "fallback", runnerIds: ["ruff-lint"] },
			// Architectural rules
			{ mode: "fallback", runnerIds: ["architect"] },
		],
	},

	/**
	 * Go linting tools
	 */
	go: {
		name: "Go Linting",
		groups: [
			// Go vet
			{ mode: "fallback", runnerIds: ["go-vet"] },
			// Architectural rules
			{ mode: "fallback", runnerIds: ["architect"] },
		],
	},

	/**
	 * Rust linting tools
	 */
	rust: {
		name: "Rust Linting",
		groups: [
			// Cargo clippy
			{ mode: "fallback", runnerIds: ["rust-clippy"] },
			// Architectural rules
			{ mode: "fallback", runnerIds: ["architect"] },
		],
	},

	/**
	 * C/C++ linting tools
	 */
	cxx: {
		name: "C/C++ Linting",
		groups: [
			// Architectural rules
			{ mode: "fallback", runnerIds: ["architect"] },
		],
	},

	/**
	 * JSON/JSONC files
	 */
	json: {
		name: "JSON Processing",
		groups: [
			// Biome handles JSON well
			{ mode: "fallback", runnerIds: ["biome-lint"] },
		],
	},

	/**
	 * Markdown files
	 */
	markdown: {
		name: "Markdown Processing",
		groups: [
			// Spellcheck for typos
			{ mode: "fallback", runnerIds: ["spellcheck"] },
		],
	},

	/**
	 * Shell scripts
	 */
	shell: {
		name: "Shell Script Linting",
		groups: [
			// Shellcheck for bash/sh/zsh linting
			{ mode: "fallback", runnerIds: ["shellcheck"] },
			// Architectural rules
			{ mode: "fallback", runnerIds: ["architect"] },
		],
	},

	/**
	 * CMake files
	 */
	cmake: {
		name: "CMake Processing",
		groups: [
			// Architectural rules
			{ mode: "fallback", runnerIds: ["architect"] },
		],
	},
};

/**
 * Get the tool plan for a specific file kind
 */
export function getToolPlan(kind: FileKind): ToolPlan | undefined {
	return TOOL_PLANS[kind];
}

/**
 * Get all registered tool plans
 */
export function getAllToolPlans(): Record<string, ToolPlan> {
	return TOOL_PLANS;
}
