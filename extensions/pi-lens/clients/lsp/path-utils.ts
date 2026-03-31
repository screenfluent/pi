/**
 * Path utilities for pi-lens
 * 
 * Handles cross-platform path normalization, particularly
 * Windows case-insensitivity issues when using paths as Map keys.
 */

import { fileURLToPath, pathToFileURL } from "url";

/**
 * Normalize a file path for consistent Map key usage.
 * On Windows: converts to lowercase (case-insensitive filesystem)
 * On other platforms: returns path as-is (case-sensitive filesystem)
 * 
 * This ensures that "C:\foo.ts" and "c:\foo.ts" resolve to the same key.
 */
export function normalizeFilePath(filePath: string): string {
	if (process.platform === "win32") {
		return filePath.toLowerCase();
	}
	return filePath;
}

/**
 * Convert a file:// URI to a normalized path.
 * Handles URL decoding and Windows drive letter normalization.
 */
export function uriToPath(uri: string): string {
	try {
		const filePath = fileURLToPath(uri);
		return normalizeFilePath(filePath);
	} catch {
		// Not a valid file:// URI, treat as plain path
		return normalizeFilePath(uri);
	}
}

/**
 * Convert a path to a file:// URI.
 * Does NOT normalize the path - URIs preserve original casing.
 */
export function pathToUri(filePath: string): string {
	return pathToFileURL(filePath).href;
}

/**
 * Normalize a Map key lookup for file paths.
 * Use this when getting/setting values in Maps that use file paths as keys.
 */
export function normalizeMapKey(filePath: string): string {
	return normalizeFilePath(filePath);
}
