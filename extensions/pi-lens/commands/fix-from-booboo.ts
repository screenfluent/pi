/**
 * /lens-booboo-fix command - Sequential fixing from booboo results
 *
 * Reads the latest /lens-booboo review and applies automated fixes
 * for the issues found. Works sequentially through fixable issues.
 */

import * as nodeFs from "node:fs";
import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { AstGrepClient } from "../clients/ast-grep-client.ts";
import type { BiomeClient } from "../clients/biome-client.ts";
import type { ComplexityClient } from "../clients/complexity-client.ts";
import type { JscpdClient } from "../clients/jscpd-client.ts";
import type { KnipClient } from "../clients/knip-client.ts";
import type { RuffClient } from "../clients/ruff-client.ts";
import type { TypeScriptClient } from "../clients/typescript-client.ts";
import { getSourceFiles } from "../clients/scan-utils.ts";
import { isTestFile } from "../clients/file-utils.ts";

interface FixClients {
	tsClient: TypeScriptClient;
	astGrep: AstGrepClient;
	ruff: RuffClient;
	biome: BiomeClient;
	knip: KnipClient;
	jscpd: JscpdClient;
	complexity: ComplexityClient;
}

interface BoobooReview {
	meta: {
		timestamp: string;
		project: string;
		path: string;
		totalIssues: number;
		fixableCount: number;
		refactorNeeded: number;
		runners: Array<{
			name: string;
			status: string;
			findings: number;
			time: string;
		}>;
	};
}

export async function handleFixFromBooboo(
	args: string,
	ctx: ExtensionContext,
	clients: FixClients,
	pi: ExtensionAPI,
): Promise<void> {
	const targetPath = args.trim() || ctx.cwd || process.cwd();

	// Find latest booboo review
	const reviewDir = path.join(targetPath, ".pi-lens", "reviews");
	let latestReview: BoobooReview | null = null;

	// Check if reviews directory exists
	if (!nodeFs.existsSync(reviewDir)) {
		ctx.ui.notify("❌ No /lens-booboo review found (no .pi-lens/reviews directory). Run `/lens-booboo` first.", "error");
		return;
	}

	let jsonFiles: string[] = [];
	let detailedReport = "";
	let reportRelPath = ""; // Will hold relative path to markdown report
	
	try {
		const files = nodeFs.readdirSync(reviewDir);
		jsonFiles = files
			.filter((f) => f.startsWith("booboo-") && f.endsWith(".json"))
			.sort()
			.reverse();

		if (jsonFiles.length === 0) {
			ctx.ui.notify("❌ No /lens-booboo review found. Run `/lens-booboo` first to scan for issues.", "error");
			return;
		}

		const latestReviewPath = path.join(reviewDir, jsonFiles[0]);
		
		const fileContent = nodeFs.readFileSync(latestReviewPath, "utf-8");
		
		latestReview = JSON.parse(fileContent) as BoobooReview;
		
		// Load detailed markdown report for specific findings
		const mdFile = jsonFiles[0].replace(".json", ".md");
		const mdPath = path.join(reviewDir, mdFile);
		reportRelPath = path.relative(targetPath, mdPath).replace(/\\/g, "/");
		try {
			detailedReport = nodeFs.readFileSync(mdPath, "utf-8");
		} catch {
			// Ignore - we'll work without details
		}
	} catch (err) {
		console.error("[fix-from-booboo] Error reading review:", err);
		ctx.ui.notify(`❌ Error reading booboo review: ${err instanceof Error ? err.message : String(err)}`, "error");
		return;
	}

	if (!latestReview) {
		ctx.ui.notify("❌ Failed to parse booboo review. Run `/lens-booboo` again.", "error");
		return;
	}

	// Check if meta exists
	if (!latestReview.meta) {
		ctx.ui.notify("❌ Invalid booboo review format (missing meta). Run `/lens-booboo` again.", "error");
		return;
	}

	// Use meta properties directly (summary object doesn't exist in JSON)
	const totalIssues = latestReview.meta.totalIssues ?? 0;
	const fixableCount = latestReview.meta.fixableCount ?? 0;
	const refactorNeeded = latestReview.meta.refactorNeeded ?? 0;
	const timestamp = latestReview.meta.timestamp ?? "unknown";
	const runners = latestReview.meta.runners ?? [];

	ctx.ui.notify(
		`🔧 Fixing from review: ${timestamp} (${fixableCount} fixable issues)`,
		"info",
	);

	const results: string[] = [];
	let fixedCount = 0;
	const isTsProject = nodeFs.existsSync(path.join(targetPath, "tsconfig.json"));

	// Get source files with SAME exclusions as booboo uses
	// 1. Start with scan-utils getSourceFiles (excludes EXCLUDED_DIRS)
	// 2. Filter out test files (matches booboo's shouldIncludeFile)
	// 3. Filter out compiled .js in TS projects (same as booboo)
	const sourceFiles = getSourceFiles(targetPath, isTsProject).filter(file => {
		// Match booboo's shouldIncludeFile: exclude test files
		if (isTestFile(file)) return false;
		
		// Match booboo's TS project compiled JS exclusion
		if (isTsProject && file.endsWith(".ts") && nodeFs.existsSync(file.replace(/\.js$/, ".ts"))) {
			return false;
		}
		
		return true;
	});

	ctx.ui.notify(`🔧 Found ${sourceFiles.length} source file(s) to check (tests/excluded dirs skipped)`, "info");

	// 1. Biome auto-fixes for TS/JS files - run once on all files for efficiency
	if (clients.biome.isAvailable()) {
		const biomeFiles = sourceFiles.filter(f => clients.biome.isSupportedFile(f));
		if (biomeFiles.length > 0) {
			ctx.ui.notify(`🔧 Running Biome on ${biomeFiles.length} file(s)...`, "info");
			const biomeResult = clients.biome.fixFiles(biomeFiles);
			if (biomeResult.success && biomeResult.fixed > 0) {
				fixedCount += biomeResult.fixed;
				results.push(`✅ Biome: Fixed ${biomeResult.fixed} issue(s) in ${biomeFiles.length} file(s)`);
			} else if (biomeResult.success) {
				results.push(`✅ Biome: No issues found in ${biomeFiles.length} file(s)`);
			} else {
				results.push(`⚠️ Biome: ${biomeResult.error || "Failed to run"}`);
			}
		}
	}

	// 2. Ruff auto-fixes for Python files - run once on all files for efficiency
	if (clients.ruff.isAvailable()) {
		const pythonFiles = sourceFiles.filter(f => f.endsWith(".py"));
		if (pythonFiles.length > 0) {
			ctx.ui.notify(`🔧 Running Ruff on ${pythonFiles.length} Python file(s)...`, "info");
			const ruffResult = clients.ruff.fixFiles(pythonFiles);
			if (ruffResult.success && ruffResult.fixed > 0) {
				fixedCount += ruffResult.fixed;
				results.push(`✅ Ruff: Fixed ${ruffResult.fixed} issue(s) in ${pythonFiles.length} file(s)`);
			} else if (ruffResult.success) {
				results.push(`✅ Ruff: No issues found in ${pythonFiles.length} file(s)`);
			} else {
				results.push(`⚠️ Ruff: ${ruffResult.error || "Failed to run"}`);
			}
		}
	}

	// 3. Categorize findings for agent dispatch
	const agentTasks: Array<{type: string; priority: number; prompt: string}> = [];
	const deferredToRefactor: string[] = [];
	const informational: string[] = [];

	// Parse detailed report sections to build specific tasks
	const reportSections = parseReportSections(detailedReport);

	// Check for issues from booboo review runners and dispatch appropriately
	for (const runner of runners) {
		if (runner.findings === 0) continue;

		switch (runner.name) {
			case "ast-grep (design smells)": {
				// AST-grep issues can often be fixed immediately by agent
				const section = reportSections["ast-grep"];
				if (section) {
					const files = extractFilesFromSection(section);
					agentTasks.push({
						type: "ast-grep",
						priority: 1,
						prompt: `**AST Structural Issues** (${runner.findings} found)\n\nFix design smell issues in:\n${files.map(f => `- ${f}`).join("\n")}\n\nReview the /lens-booboo report for specific rule violations and apply fixes. Focus on: extracting nested logic, reducing parameter lists, converting callbacks to async/await, and removing redundant code.`,
					});
				}
				break;
			}
			case "ast-grep (similar functions)": {
				// Similar functions need major refactoring - defer
				deferredToRefactor.push(`${runner.findings} groups of similar functions - use "/lens-booboo-refactor --mode=extract-helpers"`);
				break;
			}
			case "semantic similarity (Amain)": {
				// Semantic duplicates need major refactoring - defer
				deferredToRefactor.push(`${runner.findings} semantic duplicate pairs - use "/lens-booboo-refactor --mode=consolidate"`);
				break;
			}
			case "complexity metrics": {
				// High complexity can sometimes be reduced immediately
				const section = reportSections["Complexity Metrics"];
				if (section) {
					const highCogFiles = extractComplexityFiles(section);
					if (highCogFiles.length > 0) {
						agentTasks.push({
							type: "complexity",
							priority: 2,
							prompt: `**Complexity Reduction** (${highCogFiles.length} high-complexity files)\n\nReduce cognitive complexity in:\n${highCogFiles.slice(0, 5).map(f => `- ${f.file} (cognitive: ${f.cognitive})`).join("\n")}${highCogFiles.length > 5 ? `\n- ... and ${highCogFiles.length - 5} more` : ""}\n\nApply these techniques:\n1. Extract nested logic into named functions\n2. Use early returns to reduce nesting\n3. Replace nested if/else with switch or lookup tables\n4. Simplify boolean expressions\n\nRun "/lens-booboo-refactor --mode=reduce-complexity" for major cases.`,
						});
					}
				}
				break;
			}
			case "duplicate code (jscpd)": {
				// Duplicates need extraction - defer to refactor
				deferredToRefactor.push(`${runner.findings} duplicate code blocks - use "/lens-booboo-refactor --mode=extract-helpers"`);
				break;
			}
			case "dead code (Knip)": {
				// Dead code can be removed immediately
				const section = reportSections["Dead Code"];
				if (section) {
					const deadItems = extractDeadCodeItems(section);
					if (deadItems.length > 0) {
						agentTasks.push({
							type: "dead-code",
							priority: 1, // High priority - safe to remove
							prompt: `**Dead Code Removal** (${runner.findings} items)\n\nRemove unused code:\n${deadItems.slice(0, 10).map(i => `- [${i.type}] ${i.name} in ${i.file || "unknown"}`).join("\n")}${deadItems.length > 10 ? `\n- ... and ${deadItems.length - 10} more` : ""}\n\nCheck each item is truly unused (not dynamically imported or called via reflection), then safely remove.`,
						});
					}
				}
				break;
			}
			case "type coverage": {
				// Type coverage issues - agent can add types
				const section = reportSections["Type Coverage"];
				if (section) {
					const untypedFiles = extractUntypedFiles(section);
					if (untypedFiles.length > 0) {
						agentTasks.push({
							type: "types",
							priority: 3,
							prompt: `**Add Type Annotations** (${untypedFiles.length} files with untyped identifiers)\n\nAdd explicit types to improve type coverage in:\n${untypedFiles.slice(0, 5).map(f => `- ${f.file} (${f.count} untyped)`).join("\n")}${untypedFiles.length > 5 ? `\n- ... and ${untypedFiles.length - 5} more` : ""}\n\nFocus on:\n1. Function parameters and return types\n2. Variable declarations with 'any'\n3. Object literal types\n4. Event handler signatures`,
						});
					}
				}
				break;
			}
			case "circular deps (Madge)": {
				// Circular deps need architectural refactoring - defer
				deferredToRefactor.push(`${runner.findings} circular dependency chains - use "/lens-booboo-refactor --mode=break-circular"`);
				break;
			}
			case "architectural rules": {
				// Some architectural issues can be fixed immediately
				const section = reportSections["Architectural Rules"];
				if (section) {
					const archIssues = extractArchitecturalIssues(section);
					if (archIssues.length > 0) {
						agentTasks.push({
							type: "architectural",
							priority: 2,
							prompt: `**Fix Architectural Violations** (${runner.findings} violations)\n\nFix these architectural issues:\n${archIssues.slice(0, 10).map(i => `- ${i.file}: ${i.message}`).join("\n")}${archIssues.length > 10 ? `\n- ... and ${archIssues.length - 10} more` : ""}\n\nFocus on:\n1. Replace 'any' types with proper types or 'unknown'\n2. Fix absolute paths to use path.join()\n3. Extract deeply nested functions\n4. Reduce long parameter lists with options objects`,
						});
					}
				}
				break;
			}
			case "TODO scanner": {
				informational.push(`${runner.findings} TODOs/annotations - informational only`);
				break;
			}
		}
	}

	// Build summary report
	const outputParts = [
		`🔧 /lens-booboo-fix from ${timestamp}`,
		`Found ${totalIssues} total issues, ${fixableCount} fixable`,
		"",
		"=== Automatic Fixes (Biome/Ruff) ===",
		...(results.length > 0 ? results : ["ℹ️ No automatic fixes applied"]),
		"",
	];

	// Add agent tasks
	if (agentTasks.length > 0) {
		outputParts.push(`=== Agent Work Queue (${agentTasks.length} task groups) ===`);
		agentTasks.sort((a, b) => a.priority - b.priority);
		for (const task of agentTasks) {
			outputParts.push(`\n🎯 **${task.type.toUpperCase()}** (Priority: ${task.priority})`);
		}
		outputParts.push("");
	}

	// Add deferred items
	if (deferredToRefactor.length > 0) {
		outputParts.push("=== Deferred to /lens-booboo-refactor ===");
		for (const item of deferredToRefactor) {
			outputParts.push(`⏭️ ${item}`);
		}
		outputParts.push("");
	}

	// Add informational
	if (informational.length > 0) {
		outputParts.push("=== Informational ===");
		for (const item of informational) {
			outputParts.push(`ℹ️ ${item}`);
		}
		outputParts.push("");
	}

	// Add completion status
	if (fixedCount > 0) {
		outputParts.push(`✅ Fixed ${fixedCount} issue(s) automatically with Biome/Ruff`);
		outputParts.push("");
	}

	outputParts.push("Next steps:");
	if (agentTasks.length > 0) {
		outputParts.push("- Agent will work through the tasks above (priority order)");
	}
	if (deferredToRefactor.length > 0) {
		outputParts.push('- Run "/lens-booboo-refactor" for major structural changes');
	}
	outputParts.push('- Run "/lens-booboo" again to verify fixes');

	const message = outputParts.join("\n");
	
	// Always show summary to user in UI first
	ctx.ui.notify(message, "info");
	
	// If there are agent tasks, also send a compact prompt to the agent
	if (agentTasks.length > 0) {
		// Sort by priority
		agentTasks.sort((a, b) => a.priority - b.priority);
		
		// Compact task list - just type and brief description
		const compactTasks = agentTasks.map((t, i) => {
			const briefDesc = t.type === "complexity" ? "reduce cognitive complexity" :
				t.type === "architectural" ? "fix architectural violations" :
				t.type === "dead-code" ? "remove unused code" :
				t.type === "types" ? "add type annotations" :
				t.type === "ast-grep" ? "fix design smells" : "fix issues";
			return `${i + 1}. [P${t.priority}] ${t.type}: ${briefDesc}`;
		}).join("\n");
		
		// Context-optimized prompt (~500 chars vs 4000+ before)
		const agentPrompt = `🔧 /lens-booboo-fix: ${totalIssues} issues, ${fixableCount} fixable

Auto-fixes: ${fixedCount > 0 ? `${fixedCount} issues fixed` : "none applied"}

${agentTasks.length} tasks queued (priority order):
${compactTasks}

${deferredToRefactor.length > 0 ? `\nDeferred (${deferredToRefactor.length}): Use /lens-booboo-refactor for major structural changes\n` : ""}
📄 Read ${reportRelPath} for detailed findings and file locations.

Work through tasks in priority order (P1 highest). Read specific sections of the report as needed.`;
		
		try {
			if (ctx.isIdle()) {
				pi.sendUserMessage(agentPrompt);
			} else {
				pi.sendUserMessage(agentPrompt, { deliverAs: "steer" });
			}
		} catch (err) {
			console.error("[fix-from-booboo] sendUserMessage failed:", err);
			// Error already logged, UI already notified with summary
		}
	}
}

// ============================================================================
// Report parsing helpers
// ============================================================================

interface ParsedSection {
	title: string;
	content: string;
}

function parseReportSections(report: string): Record<string, string> {
	const sections: Record<string, string> = {};
	if (!report) return sections;

	// Split on ## headers
	const parts = report.split(/^## /m);
	for (const part of parts) {
		if (!part.trim()) continue;
		const lines = part.split("\n");
		const title = lines[0].trim();
		const content = lines.slice(1).join("\n");
		sections[title] = content;
	}
	return sections;
}

function extractFilesFromSection(section: string): string[] {
	const files: string[] = [];
	// Match file paths in table rows
	const regex = /\|\s*([^|\n]+\.ts|[^|\n]+\.js|[^|\n]+\.tsx|[^|\n]+\.jsx)\s*\|/g;
	let match;
	while ((match = regex.exec(section)) !== null) {
		const file = match[1].trim();
		if (!files.includes(file)) files.push(file);
	}
	return files.slice(0, 10); // Limit to first 10
}

function extractComplexityFiles(section: string): Array<{file: string; cognitive: number}> {
	const files: Array<{file: string; cognitive: number}> = [];
	// Match complexity table rows: | file | cognitive |
	const lines = section.split("\n");
	for (const line of lines) {
		const match = line.match(/\|\s*([^|]+\.ts|[^|]+\.js)\s*\|\s*(\d+)\s*\|/);
		if (match) {
			files.push({ file: match[1].trim(), cognitive: parseInt(match[2]) });
		}
	}
	// Match report threshold: Very High Cognitive Complexity (> 30)
	return files.filter(f => f.cognitive > 30).sort((a, b) => b.cognitive - a.cognitive);
}

function extractDeadCodeItems(section: string): Array<{type: string; name: string; file?: string}> {
	const items: Array<{type: string; name: string; file?: string}> = [];
	// Match dead code table rows: | type | name | file |
	const lines = section.split("\n");
	for (const line of lines) {
		const match = line.match(/\|\s*(\w+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|/);
		if (match) {
			items.push({ type: match[1].trim(), name: match[2].trim(), file: match[3]?.trim() || undefined });
		}
	}
	return items;
}

function extractUntypedFiles(section: string): Array<{file: string; count: number}> {
	const files: Array<{file: string; count: number}> = [];
	// Match file count table rows: | file | count |
	const lines = section.split("\n");
	for (const line of lines) {
		const match = line.match(/\|\s*([^|]+\.ts|[^|]+\.js)\s*\|\s*(\d+)\s*\|/);
		if (match) {
			files.push({ file: match[1].trim(), count: parseInt(match[2]) });
		}
	}
	return files;
}

function extractArchitecturalIssues(section: string): Array<{file: string; message: string}> {
	const issues: Array<{file: string; message: string}> = [];
	// Match bullet points: - **file**: message
	const lines = section.split("\n");
	for (const line of lines) {
		const match = line.match(/-\s*\*\*([^*]+)\*\*:\s*(.+)/);
		if (match) {
			issues.push({ file: match[1].trim(), message: match[2].trim() });
		}
	}
	return issues;
}
