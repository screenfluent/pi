/**
 * Safe cross-platform spawn utilities
 *
 * Wraps child_process.spawnSync to handle Windows execution safely
 * without triggering deprecation warnings.
 *
 * Strategy:
 * - Unix: Use shell: false with normal args
 * - Windows: Manually construct command string to avoid deprecation warning,
 *   then use shell: true with no args array
 */

import { spawnSync, type SpawnOptions } from "node:child_process";

export interface SpawnResult {
	stdout: string;
	stderr: string;
	status: number | null;
	error?: Error;
}

export interface SafeSpawnOptions {
	timeout?: number;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * Escape an argument for Windows shell execution.
 * Handles spaces, quotes, $variables, and special characters.
 */
function escapeWindowsArg(arg: string): string {
	// Check if this looks like an ast-grep pattern with meta-variables ($NAME)
	// In Git Bash/MSYS2 on Windows, $VAR gets expanded by the shell
	// We need to use single quotes to prevent expansion
	if (arg.includes("$")) {
		// Use single quotes for arguments with $variables
		// Escape single quotes within the argument
		return `'${arg.replace(/'/g, "'\\''")}'`;
	}

	// If no special characters, return as-is
	if (!/[\s\"]/.test(arg)) return arg;

	// Escape quotes by doubling them
	return `"${arg.replace(/"/g, "\"\"")}"`;
}

/**
 * Construct a command string for Windows shell execution.
 * This avoids the deprecation warning by not passing an args array.
 */
function buildWindowsCommand(command: string, args: string[]): string {
	const escapedArgs = args.map(escapeWindowsArg).join(" ");
	return `${command} ${escapedArgs}`;
}

/**
 * Safely spawn a process cross-platform without shell deprecation warnings.
 *
 * On Windows: Uses shell: true but constructs the command string manually
 * to avoid the deprecation warning about unescaped args.
 * On Unix: Uses shell: false for normal execution.
 */
export function safeSpawn(
	command: string,
	args: string[],
	options?: SafeSpawnOptions,
): SpawnResult {
	if (process.platform === "win32") {
		// On Windows, construct the full command string and use shell: true
		// without an args array. This avoids the deprecation warning.
		const fullCommand = buildWindowsCommand(command, args);
		const result = spawnSync(fullCommand, {
			...(options as SpawnOptions),
			encoding: "utf-8",
			shell: true,
			windowsHide: true,
		});

		return {
			stdout: result.stdout?.toString() || "",
			stderr: result.stderr?.toString() || "",
			status: result.status,
			error: result.error,
		};
	}

	// On Unix, use shell: false (the default) with normal args
	const result = spawnSync(command, args, {
		...(options as SpawnOptions),
		encoding: "utf-8",
		shell: false,
		windowsHide: true,
	});

	return {
		stdout: result.stdout?.toString() || "",
		stderr: result.stderr?.toString() || "",
		status: result.status,
		error: result.error,
	};
}

/**
 * Check if a command is available in PATH
 */
export function isCommandAvailable(command: string): boolean {
	const result = safeSpawn(
		process.platform === "win32" ? "where" : "which",
		[command],
		{ timeout: 5000 },
	);
	return result.status === 0;
}

/**
 * Find the full path to a command (npx, node, etc.)
 */
export function findCommand(command: string): string | null {
	const finder = process.platform === "win32" ? "where" : "which";
	const result = safeSpawn(finder, [command], { timeout: 5000 });

	if (result.status !== 0) return null;

	// Take first line (first match)
	return result.stdout.trim().split("\n")[0] || null;
}
