/**
 * Bus Integration for pi-lens
 * 
 * Connects the event bus system to the existing pi-lens architecture.
 * This provides:
 * - Event aggregation for diagnostic collection
 * - Real-time progress tracking
 * - Hook integration for tool_result handler
 */

import {
	DiagnosticFound,
	RunnerStarted,
	RunnerCompleted,
	ReportReady,
	FileModified,
	SessionStarted,
	TurnEnded,
	DiagnosticAggregator,
	type Diagnostic,
} from "./events.js";
import { subscribe, enableDebug } from "./bus.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// --- Integration State ---

interface IntegrationState {
	aggregator: DiagnosticAggregator;
	runnerInProgress: Set<string>; // runnerId:filePath
	lastReport: Map<string, { output: string; timestamp: number }>;
	isEnabled: boolean;
}

const state: IntegrationState = {
	aggregator: new DiagnosticAggregator(),
	runnerInProgress: new Set(),
	lastReport: new Map(),
	isEnabled: false,
};

// --- Event Subscribers ---

let unsubscribers: Array<() => void> = [];

/**
 * Initialize the bus integration
 * Call this from session_start handler
 */
export function initBusIntegration(pi: ExtensionAPI, options?: { debug?: boolean }): void {
	if (state.isEnabled) return; // Already initialized

	if (options?.debug) {
		enableDebug(true);
	}

	// Start the diagnostic aggregator
	state.aggregator.start();

	// Subscribe to runner progress events for UI feedback
	const unsubRunnerStarted = RunnerStarted.subscribe((event) => {
		const { runnerId, filePath } = event.properties;
		state.runnerInProgress.add(`${runnerId}:${filePath}`);
	});

	const unsubRunnerCompleted = RunnerCompleted.subscribe((event) => {
		const { runnerId, filePath, durationMs, diagnosticCount } = event.properties;
		state.runnerInProgress.delete(`${runnerId}:${filePath}`);

		// Log slow runners in debug mode
		if (options?.debug && durationMs > 5000) {
			console.error(`[bus] Slow runner: ${runnerId} took ${durationMs}ms for ${filePath}`);
		}

		// Log runners that found issues
		if (diagnosticCount > 0) {
			console.error(`[bus] ${runnerId} found ${diagnosticCount} issues in ${filePath}`);
		}
	});

	// Cache reports for quick retrieval
	const unsubReportReady = ReportReady.subscribe((event) => {
		const { filePath, report, durationMs } = event.properties;
		
		// Store the report
		state.lastReport.set(filePath, {
			output: formatReport(report, durationMs),
			timestamp: Date.now(),
		});
	});

	// Track file modifications to clear stale data
	const unsubFileModified = FileModified.subscribe((event) => {
		const { filePath } = event.properties;
		
		// Clear cached report for modified file
		state.lastReport.delete(filePath);
		
		// Clear diagnostics aggregator for this file (will be repopulated)
		state.aggregator.clear(filePath);
	});

	// Store unsubscribers for cleanup
	unsubscribers = [
		unsubRunnerStarted,
		unsubRunnerCompleted,
		unsubReportReady,
		unsubFileModified,
	];

	state.isEnabled = true;

	console.error("[pi-lens] Bus integration initialized");
}

/**
 * Shutdown the bus integration
 * Call this when the extension is disabled
 */
export function shutdownBusIntegration(): void {
	if (!state.isEnabled) return;

	// Stop all subscribers
	for (const unsub of unsubscribers) {
		unsub();
	}
	unsubscribers = [];

	// Stop the aggregator
	state.aggregator.stop();

	// Clear all state
	state.runnerInProgress.clear();
	state.lastReport.clear();
	state.aggregator.clear();

	state.isEnabled = false;
}

// --- Helper Functions ---

function formatReport(
	report: { blockers: Diagnostic[]; warnings: Diagnostic[]; fixed: Diagnostic[]; silent: Diagnostic[] },
	durationMs: number,
): string {
	const lines: string[] = [];

	if (report.blockers.length > 0) {
		lines.push(`🔴 STOP — ${report.blockers.length} issue(s) must be fixed:`);
		for (const d of report.blockers.slice(0, 5)) {
			const line = d.line ? `L${d.line}: ` : "";
			lines.push(`  ${line}${d.message.split("\n")[0]}`);
		}
		if (report.blockers.length > 5) {
			lines.push(`  ... and ${report.blockers.length - 5} more`);
		}
	}

	if (report.fixed.length > 0) {
		lines.push(`✅ Auto-fixed ${report.fixed.length} issue(s)`);
	}

	if (lines.length > 0) {
		lines.push(`(completed in ${durationMs}ms)`);
	}

	return lines.join("\n");
}

// --- API for index.ts ---

/**
 * Get aggregated diagnostics for a file
 */
export function getDiagnosticsForFile(filePath: string): Diagnostic[] {
	return state.aggregator.getForFile(filePath);
}

/**
 * Get the last report output for a file
 */
export function getLastReport(filePath: string): string | undefined {
	return state.lastReport.get(filePath)?.output;
}

/**
 * Check if any runners are currently in progress for a file
 */
export function hasRunnersInProgress(filePath?: string): boolean {
	if (filePath) {
		for (const key of state.runnerInProgress) {
			if (key.endsWith(`:${filePath}`)) return true;
		}
		return false;
	}
	return state.runnerInProgress.size > 0;
}

/**
 * Get list of runners in progress
 */
export function getRunnersInProgress(): Array<{ runnerId: string; filePath: string }> {
	return Array.from(state.runnerInProgress).map((key) => {
		const [runnerId, filePath] = key.split(":");
		return { runnerId, filePath };
	});
}

/**
 * Clear all cached data
 */
export function clearBusCache(): void {
	state.lastReport.clear();
	state.aggregator.clear();
}
