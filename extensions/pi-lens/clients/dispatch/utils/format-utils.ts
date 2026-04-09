/**
 * Shared formatting utilities for dispatch system
 * 
 * Consolidated from:
 * - clients/dispatch/dispatcher.ts
 * - clients/dispatch/bus-dispatcher.ts
 * - clients/services/effect-integration.ts
 */

import type { Diagnostic, OutputSemantic } from "../types.ts";

export const EMOJI: Record<string, string> = {
	blocking: "🔴",
	warning: "🟡",
	fixed: "✅",
	info: "ℹ️",
	silent: "📊",
	none: "",
};

/**
 * Format a single diagnostic for display
 */
export function formatDiagnostic(d: Diagnostic): string {
	const line = d.line ? `L${d.line}: ` : "";
	const indented = d.message.split("\n").join("\n  ");
	return `  ${line}${indented}`;
}

/**
 * Format a group of diagnostics with semantic header
 */
export function formatDiagnostics(
	diagnostics: Diagnostic[],
	semantic: OutputSemantic | string,
	maxDisplay = 10,
): string {
	if (diagnostics.length === 0) return "";

	const emoji = EMOJI[semantic] ?? EMOJI.warning;
	let output = "";

	if (semantic === "blocking") {
		output += `\n${emoji} STOP — ${diagnostics.length} issue(s) must be fixed:\n`;
	} else if (semantic === "warning") {
		output += `\n${emoji} ${diagnostics.length} warning(s):\n`;
	} else if (semantic === "fixed") {
		output += `\n${emoji} Auto-fixed ${diagnostics.length} issue(s):\n`;
	}

	for (const d of diagnostics.slice(0, maxDisplay)) {
		output += `${formatDiagnostic(d)}\n`;
	}

	if (diagnostics.length > maxDisplay) {
		output += `  ... and ${diagnostics.length - maxDisplay} more\n`;
	}

	return output;
}
