/**
 * Diagnostic Event Types for pi-lens
 * 
 * Standardized events for the bus system.
 * These events flow through the system:
 * - Runners publish DiagnosticFound events
 * - LSP clients publish LspDiagnostic events  
 * - Aggregators subscribe and build reports
 * - UI subscribes for real-time display
 */

import { z } from "zod";
import { BusEvent } from "./bus.js";

// --- Shared Schemas ---

export const DiagnosticSeverity = z.enum(["error", "warning", "info", "hint"]);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeverity>;

export const OutputSemantic = z.enum([
	"blocking",   // Hard stop - must fix
	"warning",      // Soft stop - should fix
	"fixed",        // Auto-fix applied
	"silent",       // Track but don't display
	"none",         // No action needed
]);
export type OutputSemantic = z.infer<typeof OutputSemantic>;

export const DiagnosticSchema = z.object({
	id: z.string(),                    // Unique for deduplication
	message: z.string(),
	filePath: z.string(),
	line: z.number().optional(),
	column: z.number().optional(),
	severity: DiagnosticSeverity,
	semantic: OutputSemantic,
	tool: z.string(),                  // Which tool produced this
	rule: z.string().optional(),
	fixable: z.boolean().optional(),
	fixSuggestion: z.string().optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

export const RunnerStatus = z.enum([
	"starting",
	"running",
	"completed",
	"failed",
	"skipped",
]);
export type RunnerStatus = z.infer<typeof RunnerStatus>;

// --- Event Definitions ---

/**
 * Fired when a runner discovers diagnostics
 * Published by: dispatch runners
 * Subscribed by: aggregators, delta tracker, UI
 */
export const DiagnosticFound = BusEvent.define(
	"diagnostic.found",
	z.object({
		runnerId: z.string(),
		filePath: z.string(),
		diagnostics: z.array(DiagnosticSchema),
		durationMs: z.number(),
	}),
);

/**
 * Fired when a file is modified
 * Published by: tool_result handler, file watcher
 * Subscribed by: runner scheduler, cache invalidator
 */
export const FileModified = BusEvent.define(
	"file.modified",
	z.object({
		filePath: z.string(),
		content: z.string().optional(),
		changeType: z.enum(["write", "edit", "external"]),
	}),
);

/**
 * Fired when a file is created
 * Published by: file watcher
 * Subscribed by: runner scheduler
 */
export const FileCreated = BusEvent.define(
	"file.created",
	z.object({
		filePath: z.string(),
	}),
);

/**
 * Fired when a file is deleted
 * Published by: file watcher
 * Subscribed by: cache invalidator
 */
export const FileDeleted = BusEvent.define(
	"file.deleted",
	z.object({
		filePath: z.string(),
	}),
);

/**
 * Fired when a runner starts execution
 * Published by: dispatcher
 * Subscribed by: progress UI, metrics
 */
export const RunnerStarted = BusEvent.define(
	"runner.started",
	z.object({
		runnerId: z.string(),
		filePath: z.string(),
		timestamp: z.number(),
	}),
);

/**
 * Fired when a runner completes
 * Published by: dispatcher
 * Subscribed by: progress UI, metrics aggregator
 */
export const RunnerCompleted = BusEvent.define(
	"runner.completed",
	z.object({
		runnerId: z.string(),
		filePath: z.string(),
		status: RunnerStatus,
		durationMs: z.number(),
		diagnosticCount: z.number(),
	}),
);

/**
 * Fired when LSP publishes diagnostics
 * Published by: LSPClient (via textDocument/publishDiagnostics)
 * Subscribed by: diagnostic aggregator
 */
export const LspDiagnostic = BusEvent.define(
	"lsp.diagnostic",
	z.object({
		serverId: z.string(),        // e.g., "typescript", "pyright"
		filePath: z.string(),
		diagnostics: z.array(z.object({
			severity: z.number(),    // 1=error, 2=warn, 3=info, 4=hint
			message: z.string(),
			range: z.object({
				start: z.object({ line: z.number(), character: z.number() }),
				end: z.object({ line: z.number(), character: z.number() }),
			}),
			code: z.union([z.string(), z.number()]).optional(),
			source: z.string().optional(),
		})),
		version: z.number().optional(), // Document version for debouncing
	}),
);

/**
 * Fired when baseline is updated (for delta mode)
 * Published by: delta tracker
 * Subscribed by: diagnostic filter
 */
export const BaselineUpdated = BusEvent.define(
	"baseline.updated",
	z.object({
		filePath: z.string(),
		diagnosticIds: z.array(z.string()),
		timestamp: z.number(),
	}),
);

/**
 * Fired when aggregated report is ready
 * Published by: report aggregator
 * Subscribed by: UI, commands
 */
export const ReportReady = BusEvent.define(
	"report.ready",
	z.object({
		filePath: z.string(),
		report: z.object({
			blockers: z.array(DiagnosticSchema),
			warnings: z.array(DiagnosticSchema),
			fixed: z.array(DiagnosticSchema),
			silent: z.array(DiagnosticSchema),
		}),
		durationMs: z.number(),
	}),
);

/**
 * Fired when auto-fix is applied
 * Published by: autofix runner
 * Subscribed by: UI, file watcher
 */
export const AutoFixApplied = BusEvent.define(
	"autofix.applied",
	z.object({
		filePath: z.string(),
		runnerId: z.string(),
		fixesApplied: z.number(),
		fixes: z.array(z.object({
			line: z.number(),
			message: z.string(),
		})),
	}),
);

/**
 * Fired when session starts
 * Published by: session_start handler
 * Subscribed by: cache manager, file watcher
 */
export const SessionStarted = BusEvent.define(
	"session.started",
	z.object({
		cwd: z.string(),
		timestamp: z.number(),
	}),
);

/**
 * Fired when turn ends
 * Published by: turn_end handler
 * Subscribed by: batch processor, metrics
 */
export const TurnEnded = BusEvent.define(
	"turn.ended",
	z.object({
		cwd: z.string(),
		modifiedFiles: z.array(z.string()),
		timestamp: z.number(),
	}),
);

// --- Event Aggregator Helper ---

export class DiagnosticAggregator {
	private diagnostics = new Map<string, Diagnostic[]>();
	private unsubscribe: (() => void) | null = null;

	start() {
		this.unsubscribe = DiagnosticFound.subscribe((event) => {
			const { filePath, diagnostics } = event.properties;
			const existing = this.diagnostics.get(filePath) ?? [];
			
			// Merge and dedupe by id
			const merged = [...existing, ...diagnostics];
			const unique = new Map(merged.map(d => [d.id, d]));
			
			this.diagnostics.set(filePath, Array.from(unique.values()));
		});
	}

	stop() {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	getForFile(filePath: string): Diagnostic[] {
		return this.diagnostics.get(filePath) ?? [];
	}

	getAll(): Map<string, Diagnostic[]> {
		return new Map(this.diagnostics);
	}

	clear(filePath?: string) {
		if (filePath) {
			this.diagnostics.delete(filePath);
		} else {
			this.diagnostics.clear();
		}
	}
}
