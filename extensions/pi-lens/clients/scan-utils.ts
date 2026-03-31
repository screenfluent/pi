import * as fs from "node:fs";
import * as path from "node:path";
import { EXCLUDED_DIRS, isTestFile } from "./file-utils.js";

/**
 * Common parsing logic for ast-grep JSON output (handles both array and NDJSON).
 */
// biome-ignore lint/suspicious/noExplicitAny: ast-grep JSON output is untyped
export function parseAstGrepJson(raw: string): any[] {
	if (!raw) return [];
	const trimmed = raw.trim();
	if (trimmed.startsWith("[")) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return [];
		}
	}
	return trimmed.split("\n").flatMap((l) => {
		try {
			return [JSON.parse(l)];
		} catch {
			return [];
		}
	});
}

/**
 * Check if a file should be ignored based on project type and common patterns.
 */
export function shouldIgnoreFile(
	filePath: string,
	isTsProject: boolean,
): boolean {
	const relPath = filePath.replace(/\\/g, "/");
	const _basename = path.basename(relPath);

	// Ignore compiled JS in TS projects
	const isJs =
		relPath.endsWith(".js") ||
		relPath.endsWith(".mjs") ||
		relPath.endsWith(".cjs");
	if (isTsProject && isJs) return true;

	// Ignore test scripts and common test patterns
	if (isTestFile(filePath)) return true;

	// Ignore hidden directories and common build outputs
	if (EXCLUDED_DIRS.some((d) => relPath.includes(`/${d}/`))) return true;

	return false;
}

/**
 * Recursively find source files in a directory, respecting common excludes.
 */
export function getSourceFiles(dir: string, isTsProject: boolean): string[] {
	const files: string[] = [];
	if (!fs.existsSync(dir)) return files;

	const scan = (d: string) => {
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const full = path.join(d, entry.name);
			if (entry.isDirectory()) {
				if (EXCLUDED_DIRS.includes(entry.name)) continue;
				scan(full);
			} else if (/\.(ts|tsx|js|jsx|py|go|rs)$/.test(entry.name)) {
				// Skip compiled JS if it's a TS project
				if (
					isTsProject &&
					entry.name.endsWith(".js") &&
					fs.existsSync(full.replace(/\.js$/, ".ts"))
				)
					continue;
				files.push(full);
			}
		}
	};
	scan(dir);
	return files;
}
