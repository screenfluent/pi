/**
 * Format Service for pi-lens
 *
 * Concurrent formatter execution using Effect-TS.
 * Auto-formats files on write with multiple formatters per file.
 *
 * Key features:
 * - Auto-detects formatters based on project config
 * - Runs multiple formatters concurrently with concurrency limits
 * - FileTime integration for safety
 * - Multiple formatters per file (e.g., biome + prettier both run)
 */

import * as path from "node:path";
import { FileTime } from "./file-time.js";
import {
	clearFormatterRuntimeState,
	type FormatterInfo,
	type FormatterResult,
	formatFile,
	getFormattersForFile,
} from "./formatters.js";

// --- Configuration ---

/** Maximum concurrent formatters to prevent resource contention */
const DEFAULT_FORMATTER_CONCURRENCY = 2;

// --- Types ---

export interface FormatOptions {
	/** Skip auto-format even if enabled (manual mode) */
	skip?: boolean;
	/** Specific formatters to use (overrides detection) */
	formatters?: string[];
}

export interface FormatSummary {
	filePath: string;
	formatters: Array<{
		name: string;
		success: boolean;
		changed: boolean;
		error?: string;
	}>;
	anyChanged: boolean;
	allSucceeded: boolean;
}

// --- Format Service ---

export class FormatService {
	private fileTime: FileTime;
	private enabled: boolean;

	constructor(sessionID: string, enabled: boolean = true) {
		this.fileTime = new FileTime(sessionID);
		this.enabled = enabled;
	}

	/**
	 * Format a file with all detected formatters
	 * Runs formatters with limited concurrency to prevent resource contention
	 */
	async formatFile(
		filePath: string,
		options: FormatOptions = {},
	): Promise<FormatSummary> {
		const absolutePath = path.resolve(filePath);
		const cwd = path.dirname(absolutePath);

		// Skip if disabled
		if (options.skip || !this.enabled) {
			return {
				filePath: absolutePath,
				formatters: [],
				anyChanged: false,
				allSucceeded: true,
			};
		}

		// Check if file was modified externally (safety check)
		if (this.fileTime.hasChanged(absolutePath)) {
			console.warn(
				`[format] File ${absolutePath} modified externally, skipping format`,
			);
			return {
				filePath: absolutePath,
				formatters: [],
				anyChanged: false,
				allSucceeded: false,
			};
		}

		// Get formatters for this file
		const formatters = options.formatters
			? await this.getFormattersByName(options.formatters)
			: await getFormattersForFile(absolutePath, cwd);

		if (formatters.length === 0) {
			return {
				filePath: absolutePath,
				formatters: [],
				anyChanged: false,
				allSucceeded: true,
			};
		}

		// Run formatters with limited concurrency
		const results = await this.runFormattersWithConcurrency(
			absolutePath,
			formatters,
		);

		// Record new file state after formatting
		this.fileTime.read(absolutePath);

		// Build summary
		const anyChanged = results.some((r) => r.changed);
		const allSucceeded = results.every((r) => r.success);

		return {
			filePath: absolutePath,
			formatters: results.map((r, i) => ({
				name: formatters[i].name,
				success: r.success,
				changed: r.changed,
				error: r.error,
			})),
			anyChanged,
			allSucceeded,
		};
	}

	/**
	 * Run formatters sequentially to avoid concurrent writes to the same file.
	 */
	private async runFormattersWithConcurrency(
		filePath: string,
		formatters: FormatterInfo[],
		_concurrency = DEFAULT_FORMATTER_CONCURRENCY,
	): Promise<FormatterResult[]> {
		const results: FormatterResult[] = [];

		for (const formatter of formatters) {
			try {
				const timeoutMs = 30000;
				const timeoutPromise = new Promise<FormatterResult>((_, reject) => {
					setTimeout(
						() =>
							reject(
								new Error(
									`Formatter ${formatter.name} timed out after ${timeoutMs}ms`,
								),
							),
						timeoutMs,
					);
				});

				const result = await Promise.race([
					formatFile(filePath, formatter),
					timeoutPromise,
				]);
				results.push(result);
			} catch (error) {
				results.push({
					success: false,
					changed: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return results;
	}

	/**
	 * Get formatters by name (for explicit formatter selection)
	 */
	private async getFormattersByName(names: string[]): Promise<FormatterInfo[]> {
		const { listAllFormatters, ...formatters } = await import(
			"./formatters.js"
		);
		const allNames = listAllFormatters();

		return names
			.filter((name) => allNames.includes(name))
			.map((name) => {
				// Access formatter by name from the exports
				const key = `${name}Formatter` as keyof typeof formatters;
				return formatters[key] as FormatterInfo;
			})
			.filter(Boolean);
	}

	/**
	 * Assert file hasn't changed before editing
	 * Throws FileTimeError if file modified externally
	 */
	assertUnchanged(filePath: string): void {
		this.fileTime.assert(filePath);
	}

	/**
	 * Check if file has changed externally
	 */
	hasChanged(filePath: string): boolean {
		return this.fileTime.hasChanged(filePath);
	}

	/**
	 * Record file read (after agent reads file)
	 */
	recordRead(filePath: string): void {
		this.fileTime.read(filePath);
	}

	/**
	 * Clear detection cache
	 */
	clearCache(): void {
		clearFormatterRuntimeState();
	}
}

// --- Singleton Instance ---

let globalFormatService: FormatService | null = null;
let currentSessionID: string | null = null;

export function getFormatService(
	sessionID?: string,
	enabled: boolean = true,
): FormatService {
	// Create new instance if:
	// 1. No service exists yet
	// 2. Session ID changed (different session)
	const shouldCreateNew =
		!globalFormatService || (sessionID && sessionID !== currentSessionID);

	if (shouldCreateNew) {
		globalFormatService = new FormatService(sessionID ?? "default", enabled);
		currentSessionID = sessionID ?? "default";
	}
	return globalFormatService!;
}

export function resetFormatService(): void {
	clearFormatterRuntimeState();
	globalFormatService = null;
	currentSessionID = null;
}

/**
 * Reset format service and clear all file tracking state.
 * Use this in tests to ensure complete isolation.
 */
export function clearFormatServiceAndFileState(): void {
	resetFormatService();
}

// Re-export for convenience
export { clearAllSessions } from "./file-time.js";
