/**
 * Shared architectural debt scanning.
 * Scans ast-grep skip rules + complexity metrics + architect.yaml rules.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectClient } from "./architect-client.js";
import type { AstGrepClient } from "./ast-grep-client.js";
import type { ComplexityClient } from "./complexity-client.js";
import { safeSpawn } from "./safe-spawn.js";
import { getSourceFiles, parseAstGrepJson } from "./scan-utils.js";

export type SkipIssue = { rule: string; line: number; note: string };
export type FileMetrics = { mi: number; cognitive: number; nesting: number };

/**
 * Scan for skip-category ast-grep violations grouped by absolute file path.
 */
export function scanSkipViolations(
	astGrepClient: AstGrepClient,
	configPath: string,
	targetPath: string,
	isTsProject: boolean,
	skipRules: Set<string>,
	ruleActions: Record<string, { note?: string }>,
): Map<string, SkipIssue[]> {
	const skipByFile = new Map<string, SkipIssue[]>();
	if (!astGrepClient.isAvailable()) return skipByFile;

	const sgResult = safeSpawn(
		"npx",
		[
			"sg",
			"scan",
			"--config",
			configPath,
			"--json",
			"--globs",
			"!**/*.test.ts",
			"--globs",
			"!**/*.spec.ts",
			"--globs",
			"!**/test-utils.ts",
			"--globs",
			"!**/.pi-lens/**",
			...(isTsProject ? ["--globs", "!**/*.js"] : []),
			targetPath,
		],
		{
			timeout: 30000,
		},
	);

	const items = parseAstGrepJson(sgResult.stdout?.trim() ?? "");

	for (const item of items) {
		const rule = item.ruleId || item.rule?.title || item.name || "unknown";
		if (!skipRules.has(rule)) continue;
		const line =
			(item.labels?.[0]?.range?.start?.line ?? item.range?.start?.line ?? 0) +
			1;
		const absFile = path.resolve(item.file ?? "");
		const list = skipByFile.get(absFile) ?? [];
		list.push({ rule, line, note: ruleActions[rule]?.note ?? "" });
		skipByFile.set(absFile, list);
	}
	return skipByFile;
}

/**
 * Scan complexity metrics for all supported files, grouped by absolute file path.
 */
export function scanComplexityMetrics(
	complexityClient: ComplexityClient,
	targetPath: string,
	isTsProject: boolean,
): Map<string, FileMetrics> {
	const metricsByFile = new Map<string, FileMetrics>();
	const files = getSourceFiles(targetPath, isTsProject);

	for (const full of files) {
		if (
			complexityClient.isSupportedFile(full) &&
			!/\.(test|spec)\.[jt]sx?$/.test(path.basename(full))
		) {
			const m = complexityClient.analyzeFile(full);
			if (m)
				metricsByFile.set(full, {
					mi: m.maintainabilityIndex,
					cognitive: m.cognitiveComplexity,
					nesting: m.maxNestingDepth,
				});
		}
	}
	return metricsByFile;
}

/**
 * Scan for architectural rule violations grouped by absolute file path.
 * Returns map of absolute file path → list of violation messages.
 */
export function scanArchitectViolations(
	architectClient: ArchitectClient,
	targetPath: string,
): Map<string, string[]> {
	const violationsByFile = new Map<string, string[]>();
	if (!architectClient.hasConfig()) return violationsByFile;

	const isTsProject = fs.existsSync(path.join(targetPath, "tsconfig.json"));
	const files = getSourceFiles(targetPath, isTsProject);

	for (const full of files) {
		const relPath = path.relative(targetPath, full).replace(/\\/g, "/");
		const content = fs.readFileSync(full, "utf-8");
		const lineCount = content.split("\n").length;
		const msgs: string[] = [];

		// Check pattern violations
		for (const v of architectClient.checkFile(relPath, content)) {
			const lineStr = v.line ? `L${v.line}: ` : "";
			msgs.push(`${lineStr}${v.message}`);
		}

		// Check file size
		const sizeV = architectClient.checkFileSize(relPath, lineCount);
		if (sizeV) {
			msgs.push(sizeV.message);
		}

		if (msgs.length > 0) {
			violationsByFile.set(full, msgs);
		}
	}
	return violationsByFile;
}

/**
 * Score each file by combined debt signal. Higher = worse.
 */
export function scoreFiles(
	skipByFile: Map<string, SkipIssue[]>,
	metricsByFile: Map<string, FileMetrics>,
	architectViolations?: Map<string, string[]>,
): { file: string; score: number }[] {
	const allFiles = new Set([
		...skipByFile.keys(),
		...metricsByFile.keys(),
		...(architectViolations?.keys() ?? []),
	]);
	return [...allFiles]
		.map((file) => {
			let score = 0;
			const m = metricsByFile.get(file);
			if (m) {
				if (m.mi < 20) score += 5;
				else if (m.mi < 40) score += 3;
				else if (m.mi < 60) score += 1;
				if (m.cognitive > 300) score += 4;
				else if (m.cognitive > 150) score += 2;
				else if (m.cognitive > 80) score += 1;
				if (m.nesting > 8) score += 2;
				else if (m.nesting > 5) score += 1;
			}
			for (const issue of skipByFile.get(file) ?? []) {
				if (issue.rule === "large-class") score += 5;
				else if (issue.rule === "no-as-any") score += 2;
				else score += 1;
			}
			// Architect violations are high-priority signals
			const archMsgs = architectViolations?.get(file);
			if (archMsgs && archMsgs.length > 0) {
				score += archMsgs.length * 3; // Each violation = 3 points
			}
			return { file, score };
		})
		.filter((f) => f.score > 0)
		.sort((a, b) => b.score - a.score);
}

/**
 * Read a code snippet around the first violation line.
 * Returns { snippet, start, end } or null.
 */
export function extractCodeSnippet(
	filePath: string,
	firstLine: number,
	contextLines = 2,
	maxLines = 45,
): { snippet: string; start: number; end: number } | null {
	try {
		const fileLines = fs.readFileSync(filePath, "utf-8").split("\n");
		const start = Math.max(0, firstLine - 1 - contextLines);
		const end = Math.min(fileLines.length, start + maxLines);
		return {
			snippet: fileLines.slice(start, end).join("\n"),
			start: start + 1,
			end,
		};
	} catch {
		return null;
	}
}
