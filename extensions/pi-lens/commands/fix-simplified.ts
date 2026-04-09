/**
 * Simplified Fix command for pi-lens
 *
 * One-shot code review & cleanup - no loop, no session.
 * Replaces the complex auto-loop with a simple one-shot approach.
 */

import * as childProcess from "node:child_process";
import * as nodeFs from "node:fs";
import * as path from "node:path";
import { safeSpawn } from "../clients/safe-spawn.ts";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { AstGrepClient } from "../clients/ast-grep-client.ts";
import type { BiomeClient } from "../clients/biome-client.ts";
import { CacheManager } from "../clients/cache-manager.ts";
import { detectFileKind } from "../clients/file-kinds.ts";
import { EXCLUDED_DIRS, isTestFile } from "../clients/file-utils.ts";
import type { ComplexityClient } from "../clients/complexity-client.ts";
import type { JscpdClient } from "../clients/jscpd-client.ts";
import type { KnipClient } from "../clients/knip-client.ts";
import type { RuffClient } from "../clients/ruff-client.ts";
import type { TypeScriptClient } from "../clients/typescript-client.ts";

// --- Types ---
interface FixClients {
	tsClient: TypeScriptClient;
	astGrep: AstGrepClient;
	ruff: RuffClient;
	biome: BiomeClient;
	knip: KnipClient;
	jscpd: JscpdClient;
	complexity: ComplexityClient;
}

interface Issue {
	file: string;
	line?: number;
	category: "reuse" | "quality" | "architecture" | "types";
	rule: string;
	message: string;
	fixable: boolean;
	autoFix?: string;
	severity: "error" | "warning" | "hint";
}

// --- Ignore file management ---
const IGNORE_FILE = ".pi-lens/.booboo-ignore";

interface IgnoreEntry {
	pattern: string;
	addedAt: string;
	reason?: string;
}

function loadIgnoreFile(cwd: string): IgnoreEntry[] {
	try {
		const content = nodeFs.readFileSync(path.join(cwd, IGNORE_FILE), "utf-8");
		return content
			.split("\n")
			.filter((l) => l.trim() && !l.startsWith("#"))
			.map((l) => {
				const [pattern, reason] = l.split(" #").map((s) => s.trim());
				return { pattern, addedAt: new Date().toISOString(), reason };
			});
	} catch {
		return [];
	}
}

function saveIgnoreFile(cwd: string, entries: IgnoreEntry[]) {
	const content =
		"# /lens-booboo-fix ignore patterns\n" +
		"# Format: type:file:line # optional reason\n" +
			entries.map((e) => `${e.pattern}${e.reason ? " # " + e.reason : ""}`).join("\n");
	nodeFs.mkdirSync(path.dirname(path.join(cwd, IGNORE_FILE)), { recursive: true });
	nodeFs.writeFileSync(path.join(cwd, IGNORE_FILE), content, "utf-8");
}

function isIgnored(pattern: string, entries: IgnoreEntry[]): boolean {
	return entries.some((e) => {
		// Simple glob matching
		const regex = new RegExp(e.pattern.replace(/\*/g, ".*").replace(/:/g, "\\:"));
		return regex.test(pattern);
	});
}

// --- Get changed files ---
function getChangedFiles(cwd: string): string[] {
	const files = new Set<string>();

	// 1. From git diff
	try {
		const gitResult = childProcess.spawnSync(
			"git",
			["diff", "HEAD", "--name-only", "--diff-filter=ACM"],
			{ encoding: "utf-8", cwd },
		);
		if (gitResult.status === 0) {
			gitResult.stdout.split("\n").forEach((f) => {
				if (f.trim()) files.add(path.join(cwd, f.trim()));
			});
		}
	} catch {
		// Git not available or not a repo
	}

	// 2. From cache-manager turn state (for files edited in this session)
	const cacheManager = new CacheManager();
	const turnState = cacheManager.readTurnState(cwd);
	for (const file of Object.keys(turnState.files)) {
		files.add(path.join(cwd, file));
	}

	return Array.from(files).filter((f) => nodeFs.existsSync(f));
}

// --- File filtering ---
/**
 * Check if file should be scanned based on exclusion rules:
 * - Test files (.test.ts, .spec.ts, etc.)
 * - Excluded directories (node_modules, dist, etc.)
 * - Hidden directories (.git, .pi-lens, etc.)
 */
function shouldScanFile(filePath: string): boolean {
	const normalized = filePath.replace(/\\/g, "/");
	
	// Skip test files
	if (isTestFile(normalized)) {
		return false;
	}
	
	// Skip excluded directories
	for (const dir of EXCLUDED_DIRS) {
		if (normalized.includes(`/${dir}/`) || normalized.includes(`\\${dir}\\`)) {
			return false;
		}
	}
	
	return true;
}

// --- Issue detection (AST-grep only - structural issues) ---
async function detectStructuralIssues(
	files: string[],
	cwd: string,
	ignoreEntries: IgnoreEntry[],
	clients: FixClients,
): Promise<Issue[]> {
	const issues: Issue[] = [];

	// Only scan files that pass exclusion filters
	const filesToScan = files.filter(shouldScanFile);

	// Run ast-grep for structural issues (these need human decisions)
	await Promise.all(
		filesToScan.map(async (file) => {
			const relPath = path.relative(cwd, file);
			const kind = detectFileKind(file);

			// Python files: scan for slop patterns
			if (kind === "python" && clients.astGrep.isAvailable()) {
				const slopMatches = scanPythonSlop(file, cwd);
				for (const m of slopMatches) {
					const id = `python-slop:${relPath}:${m.line}`;
					if (isIgnored(id, ignoreEntries)) continue;
					issues.push({
						file: relPath,
						line: m.line,
						category: "quality",
						rule: m.rule,
						message: `[slop] ${m.message}`,
						fixable: m.fixable,
						autoFix: m.fix,
						severity: m.severity,
					});
				}
			}

			// JavaScript/TypeScript files: scan for slop patterns first
			if (kind === "jsts" && clients.astGrep.isAvailable()) {
				const slopMatches = scanTsSlop(file, cwd);
				for (const m of slopMatches) {
					const id = `ts-slop:${relPath}:${m.line}`;
					if (isIgnored(id, ignoreEntries)) continue;
					issues.push({
						file: relPath,
						line: m.line,
						category: "quality",
						rule: m.rule,
						message: `[slop] ${m.message}`,
						fixable: m.fixable,
						autoFix: m.fix,
						severity: m.severity,
					});
				}
				
				// Also run existing AST-grep structural rules
				const matches = clients.astGrep.scanFile(file);
				for (const m of matches) {
					const id = `ast:${relPath}:${m.line}`;
					if (isIgnored(id, ignoreEntries)) continue;
					const isSafeFix = isSafeAstGrepFix(m.rule);
					issues.push({
						file: relPath,
						line: m.line,
						category: "quality",
						rule: m.rule,
						message: m.message,
						fixable: !!(m.ruleDescription?.fix || isSafeFix),
						autoFix: m.ruleDescription?.fix,
						severity: m.severity === "error" ? "error" : "warning",
					});
				}
			}
		}),
	);

	return prioritizeIssues(issues);
}

// --- Python slop detection ---
interface SlopMatch {
	line: number;
	rule: string;
	message: string;
	severity: "error" | "warning";
	fixable: boolean;
	fix?: string;
}

function scanPythonSlop(filePath: string, cwd: string): SlopMatch[] {
	const matches: SlopMatch[] = [];
	
	// Find Python slop config
	const configPaths = [
		path.join(cwd, "rules/python-slop-rules/.sgconfig.yml"),
		path.join(cwd, "../rules/python-slop-rules/.sgconfig.yml"),
		path.join(process.cwd(), "rules/python-slop-rules/.sgconfig.yml"),
	];
	
	let configPath: string | undefined;
	for (const p of configPaths) {
		if (nodeFs.existsSync(p)) {
			configPath = p;
			break;
		}
	}
	
	if (!configPath) return matches;
	
	try {
		const result = safeSpawn(
			"npx",
			["sg", "scan", "--config", configPath, "--json", filePath],
			{
				timeout: 30000,
			}
		);
		
		const output = result.stdout || result.stderr || "";
		if (!output.trim()) return matches;
		
		const parsed = JSON.parse(output);
		if (Array.isArray(parsed)) {
			for (const item of parsed) {
				const weight = item.metadata?.weight || 3;
				matches.push({
					line: (item.range?.start?.line || 0) + 1,
					rule: item.rule || "slop",
					message: item.message || "",
					severity: weight >= 4 ? "error" : "warning",
					fixable: !!item.replacement,
					fix: item.replacement,
				});
			}
		}
	} catch {
		// Failed to scan, return empty
	}
	
	return matches;
}

function scanTsSlop(filePath: string, cwd: string): SlopMatch[] {
	const matches: SlopMatch[] = [];
	
	// Find TypeScript slop config
	const configPaths = [
		path.join(cwd, "rules/ts-slop-rules/.sgconfig.yml"),
		path.join(cwd, "../rules/ts-slop-rules/.sgconfig.yml"),
		path.join(process.cwd(), "rules/ts-slop-rules/.sgconfig.yml"),
	];
	
	let configPath: string | undefined;
	for (const p of configPaths) {
		if (nodeFs.existsSync(p)) {
			configPath = p;
			break;
		}
	}
	
	if (!configPath) return matches;
	
	try {
		const result = safeSpawn(
			"npx",
			["sg", "scan", "--config", configPath, "--json", filePath],
			{
				timeout: 30000,
			}
		);
		
		const output = result.stdout || result.stderr || "";
		if (!output.trim()) return matches;
		
		const parsed = JSON.parse(output);
		if (Array.isArray(parsed)) {
			for (const item of parsed) {
				const weight = item.metadata?.weight || 3;
				matches.push({
					line: (item.range?.start?.line || 0) + 1,
					rule: item.rule || "slop",
					message: item.message || "",
					severity: weight >= 4 ? "error" : "warning",
					fixable: !!item.replacement,
					fix: item.replacement,
				});
			}
		}
	} catch {
		// Failed to scan, return empty
	}
	
	return matches;
}

// --- Biome auto-fix (silent - no reporting) ---
async function autoFixWithBiome(
	files: string[],
	clients: FixClients,
): Promise<number> {
	if (!clients.biome.isAvailable()) return 0;

	let fixedCount = 0;

	// Only fix files that pass exclusion filters and are supported by biome
	const filesToFix = files.filter(
		(f => shouldScanFile(f) && clients.biome.isSupportedFile(f))
	);

	if (filesToFix.length === 0) return 0;

	// Run biome with --write --unsafe to auto-fix all issues
	// We run biome once on all files for efficiency
	const biomeArgs = ["check", "--write", "--unsafe", ...filesToFix];
	
	try {
		const result = safeSpawn("biome", biomeArgs, {
			timeout: 60000,
		});

		// Parse output to count fixed issues
		// Biome outputs formatted files count
		const output = result.stdout || result.stderr || "";
		const fixedMatch = output.match(/Fixed (\d+) file/);
		if (fixedMatch) {
			fixedCount = parseInt(fixedMatch[1], 10);
		}
		
		// Also count individual fixes from the output
		const fixMatches = output.match(/✓|✅|Fixed/g);
		if (fixMatches && fixedCount === 0) {
			fixedCount = fixMatches.length;
		}
	} catch {
		// Biome not available or failed
	}

	return fixedCount;
}

function getLanguageFromKind(kind: string): string | undefined {
	if (kind === "typescript") return "typescript";
	if (kind === "typescript-tsx") return "typescript";
	if (kind === "javascript") return "javascript";
	if (kind === "javascript-jsx") return "javascript";
	if (kind === "python") return "python";
	if (kind === "go") return "go";
	if (kind === "rust") return "rust";
	return undefined;
}

function isTypeScriptKind(kind: string | undefined): boolean {
	return kind === "typescript" || kind === "typescript-tsx" || kind === "javascript" || kind === "javascript-jsx";
}

function isSafeAstGrepFix(rule: string): boolean {
	const safeRules = [
		"strict-equality",
		"strict-inequality",
		"no-debugger",
		"no-array-constructor",
		"no-extra-boolean-cast",
	];
	return safeRules.includes(rule);
}

function prioritizeIssues(issues: Issue[]): Issue[] {
	const severityOrder = { error: 0, warning: 1, hint: 2 };
	const categoryOrder = { types: 0, architecture: 1, quality: 2, reuse: 3 };

	return issues.sort((a, b) => {
		const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
		if (sevDiff !== 0) return sevDiff;
		return categoryOrder[a.category] - categoryOrder[b.category];
	});
}

// --- Safe ast-grep fixes (for issues that can't be handled by biome) ---
async function applySafeAstGrepFixes(issues: Issue[], cwd: string): Promise<number> {
	let fixed = 0;

	for (const issue of issues) {
		if (!issue.fixable || !issue.autoFix) continue;
		// Only apply very safe fixes that biome doesn't handle
		if (!isSafeAstGrepFix(issue.rule)) continue;

		const filePath = path.join(cwd, issue.file);
		if (!nodeFs.existsSync(filePath)) continue;

		const content = nodeFs.readFileSync(filePath, "utf-8");
		const lines = content.split("\n");

		// Simple line-based replacements (very conservative)
		if (issue.line && issue.line <= lines.length) {
			const lineIndex = issue.line - 1;
			const originalLine = lines[lineIndex];

			// Apply specific safe transformations
			let newLine = originalLine;

			if (issue.rule === "strict-equality") {
				newLine = originalLine.replace(/==([^=])/g, "===$1");
				newLine = newLine.replace(/!([^=])/g, "!==$1");
			} else if (issue.rule === "no-debugger") {
				if (originalLine.trim() === "debugger;") {
					newLine = "";
				}
			}

			if (newLine !== originalLine) {
				lines[lineIndex] = newLine;
				nodeFs.writeFileSync(filePath, lines.join("\n"), "utf-8");
				fixed++;
			}
		}
	}

	return fixed;
}

// --- Action Prompt Generation (imperative - tells AI to fix) ---
function generateActionPrompt(
	issues: Issue[],
	fixed: number,
	files: string[],
	cwd: string,
): string {
	// Sort issues: errors first, then by severity
	const sortedIssues = [...issues].sort((a, b) => {
		if (a.severity === "error" && b.severity !== "error") return -1;
		if (b.severity === "error" && a.severity !== "error") return 1;
		return 0;
	});

	let prompt = `🔧 /LENS-BOOBOO-FIX: ${issues.length} structural issue(s) found in changed files.\n\n`;
	
	if (fixed > 0) {
		prompt += `✅ Already auto-fixed ${fixed} mechanical issue(s) with Biome.\n\n`;
	}

	prompt += `**ACTION REQUIRED:** Fix the following structural issues using the edit tool.\n`;
	prompt += `Focus on error severity first, then warnings.\n\n`;

	// List issues with specific actions
	const errors = sortedIssues.filter(i => i.severity === "error");
	const warnings = sortedIssues.filter(i => i.severity !== "error");

	if (errors.length > 0) {
		prompt += `## 🔴 ERRORS (fix first):\n\n`;
		for (let i = 0; i < Math.min(errors.length, 10); i++) {
			const issue = errors[i];
			prompt += `${i + 1}. **${issue.file}:${issue.line}** — ${issue.rule}\n`;
			prompt += `   ${issue.message}\n`;
			prompt += `   **Action:** ${getFixInstruction(issue)}\n\n`;
		}
		if (errors.length > 10) {
			prompt += `   ... and ${errors.length - 10} more errors\n\n`;
		}
	}

	if (warnings.length > 0) {
		prompt += `## 🟡 WARNINGS (fix if time):\n\n`;
		for (let i = 0; i < Math.min(warnings.length, 10); i++) {
			const issue = warnings[i];
			prompt += `${i + 1}. **${issue.file}:${issue.line}** — ${issue.rule}\n`;
			prompt += `   ${issue.message.substring(0, 80)}${issue.message.length > 80 ? "..." : ""}\n`;
			prompt += `   **Action:** ${getFixInstruction(issue)}\n\n`;
		}
		if (warnings.length > 10) {
			prompt += `   ... and ${warnings.length - 10} more warnings\n\n`;
		}
	}

	prompt += `**IMPORTANT GUIDANCE:**\n\n`;
	prompt += `These structural issues fall into three categories:\n`;
	prompt += `1. **Quick fixes** (do these now): no-debugger, strict-equality, empty-catch blocks\n`;
	prompt += `2. **False positives** (mark and skip): The rule is technically wrong for this context\n`;
	prompt += `3. **Deep architectural issues** (defer to /lens-booboo-refactor): large-class, long-method requiring major restructuring\n\n`;
	prompt += `**Your approach:**\n`;
	prompt += `- 🔧 Quick fixes: Fix immediately (1-2 edits max per issue)\n`;
	prompt += `- 🤔 Evaluate: Fix if trivial, mark as false positive if the rule is wrong\n`;
	prompt += `- 🏗️ Defer: Skip and use "/lens-booboo-refactor" for deep architectural work\n`;
	prompt += `- Mark false positives with: /lens-booboo-fix --false-positive "rule:file:line"\n`;
	prompt += `- Focus on errors first, then quick fix warnings\n\n`;
	prompt += `**ANTI-SLOP REMINDER:**\n\n`;
	prompt += `When fixing **Python** code, avoid these common slop patterns:\n`;
	prompt += `- Use \`enumerate()\` instead of \`range(len(x))\`\n`;
	prompt += `- Use built-in \`min()\`/\`max()\` instead of manual if/else comparisons\n`;
	prompt += `- Use chained comparisons (\`a < b < c\`) instead of boolean chains\n`;
	prompt += `- Avoid defensive \`if x is None: return None\` guards without good reason\n`;
	prompt += `- Use \`list(iterable)\` instead of \`[x for x in iterable]\` ceremony\n`;
	prompt += `- Prefer truthiness (\`if arr:\`) over \`len(arr) > 0\`\n\n`;
	prompt += `When fixing **TypeScript/JavaScript** code, avoid these common slop patterns:\n`;
	prompt += `- Use \`for...of\` or \`.forEach()\` instead of \`for (let i = 0; i < arr.length; i++)\`\n`;
	prompt += `- Use \`Math.min()\`/\`Math.max()\` instead of manual comparisons\n`;
	prompt += `- Use optional chaining (\`obj?.prop?.nested\`) instead of guard chains\n`;
	prompt += `- Use nullish coalescing (\`x ?? default\`) instead of ternary checks\n`;
	prompt += `- Use \`arr.includes(x)\` instead of \`arr.indexOf(x) !== -1\`\n`;
	prompt += `- Prefer truthiness (\`if (arr)\`) over \`if (arr.length > 0)\`\n`;
	prompt += `- Use spread \`[...arr]\` instead of \`arr.slice()\` for copying\n\n`;
	prompt += `**Only mark as false positive if the rule is truly incorrect. Defer architectural issues to /lens-booboo-refactor, don't mark them as false positives.**`;

	return prompt;
}

function getFixInstruction(issue: Issue): string {
	// Map rules to specific fix instructions
	// 🔧 = quick fix, do now
	// 🤔 = evaluate: fix if trivial, mark FP if rule is wrong
	// 🏗️ = defer to /lens-booboo-refactor for architectural refactoring
	const instructions: Record<string, string> = {
		// TypeScript/JavaScript rules
		"long-method": "🏗️ DEFER to /lens-booboo-refactor (don't mark as FP)",
		"large-class": "🏗️ DEFER to /lens-booboo-refactor (architectural decision)",
		"empty-catch": "🔧 Add proper error handling or remove the catch",
		"long-parameter-list": "🤔 Use an options object or mark FP if intentional",
		"nested-ternary": "🔧 Convert to if/else or extract to named variables",
		"no-debugger": "🔧 Remove the debugger statement",
		"no-console-log": "🔧 Use a proper logger or remove the log",
		"strict-equality": "🔧 Change == to === and != to !==",
		"no-throw-string": "🔧 Throw new Error() instead of a string",
		"no-return-await": "🔧 Remove unnecessary await",
		"switch-without-default": "🔧 Add a default case",
		"no-shadow": "🤔 Rename variable to avoid shadowing",
		"no-non-null-assertion": "🤔 Add proper null check or mark FP if intentional",
		"no-as-any": "🤔 Replace with proper type or mark FP if intentional",
		"complex-conditional": "🤔 Extract to named boolean variables",
		"deep-nesting": "🤔 Extract nested blocks into functions",
		
		// Python slop rules
		"for-range-len": "🔧 Use enumerate() instead of range(len(x))",
		"range-len-pattern": "🔧 Use enumerate() instead of range(len(x))",
		"range-len-antipattern": "🔧 Use enumerate() or direct iteration",
		"manual-min-max": "🔧 Use built-in min() or max()",
		"boolean-return-if-else": "🔧 Simplify to return bool(condition)",
		"chained-comparison-opportunity": "🔧 Use chained comparison (a < b < c)",
		"json-dumps-then-loads": "🔧 Remove redundant round-trip",
		"pointless-bool-cast": "🔧 Remove bool() wrapper",
		"pointless-lambda-call": "🔧 Execute code directly, remove lambda",
		"ternary-same-value": "🔧 Remove condition, value is same both ways",
		"empty-init": "🔧 Remove empty __init__ or add pass",
		"explicit-bool-cast": "🔧 Remove unnecessary bool() cast",
		"guard-return-none": "🤔 Consider removing - may be overly defensive",
		"if-none-raise": "🤔 Consider EAFP pattern or keep if needed",
		"int-float-coerce": "🔧 Parse directly with validation",
		"len-comparison": "🔧 Use truthiness: if arr: instead of len(arr) > 0",
		"manual-dict-setdefault": "🔧 Use dict.setdefault()",
		"multiple-isinstance-or": "🔧 Use isinstance(x, (A, B)) tuple",
		"redundant-bool-ternary": "🔧 Use bool(x) directly",
		"redundant-list-comprehension": "🔧 Use list(iterable) directly",
		"redundant-return-none": "🔧 Remove explicit return None",
		"set-literal-list": "🔧 Use set literal {x, y}",
		"unnecessary-cast-str": "🔧 Remove str() wrapper",
		"unnecessary-elif": "🔧 Use if instead of elif after return",
		"unnecessary-else-raise": "🔧 Remove redundant else after raise",
		"unnecessary-lambda": "🔧 Pass function directly, remove lambda",
		"verbose-none-default": "🔧 Use 'x = x or default'",
		"type-equality": "🔧 Use isinstance() instead of type()",
		"dict-str-any": "🤔 Consider tightening type to avoid Any",
		"list-any": "🤔 Consider tightening element type",
		"verbose-list-append-loop": "🔧 Use list comprehension [x for x in items]",
		"set-add-loop": "🔧 Use set comprehension {x for x in items}",
		"manual-dict-get-assign": "🔧 Use dict.get(key, default)",
		"list-extend-from-loop": "🔧 Use list.extend(iterable) directly",
		"join-list-comprehension": "🔧 Use generator expression instead",
		"manual-sum-loop": "🔧 Use sum(iterable) instead of manual loop",
		"membership-test-list-literal": "🔧 Use set literal for O(1) lookup",
		"deep-dict-access": "🤔 Extract to helper or use dataclass",
		"long-tuple-unpacking": "🤔 Use namedtuple or dataclass",
		"chained-dict-get": "🤔 Consider walrus operator or get() with default",
		"nested-attribute-guard-chain": "🤔 Use getattr with default",
		"isinstance-return-ladder": "🏗️ Consider dispatch table or polymorphism",
		"manual-str-join": "🔧 Use ''.join(iterable)",
		"comprehension-used-but-ignored-result": "🔧 Use for loop or fix logic",
		"duplicated-if-condition": "🔧 Remove duplicate elif condition",
		
		// TypeScript/JavaScript slop rules
		"ts-for-index-length": "🔧 Use for-of or .forEach() instead of index loop",
		"ts-while-index-length": "🔧 Use for-of or array methods instead of while loop",
		"ts-manual-min-max": "🔧 Use Math.min() or Math.max()",
		"ts-array-map-ceremony": "🔧 Use array directly, remove unnecessary mapping",
		"ts-boolean-return-if-else": "🔧 Simplify to return !!condition or Boolean(condition)",
		"ts-json-stringify-parse": "🔧 Use structuredClone or proper copy method",
		"ts-pointless-bool-cast": "🔧 Remove Boolean() wrapper",
		"ts-double-negation": "🔧 Use Boolean(value) or truthiness directly",
		"ts-unnecessary-array-concat": "🔧 Use push(item) or spread [...arr, item]",
		"ts-defensive-null-guard": "🤔 Consider removing - may be overly defensive",
		"ts-optional-chain-opportunity": "🔧 Use optional chaining obj?.prop?.nested",
		"ts-explicit-undefined-check": "🔧 Use x === undefined or truthiness",
		"ts-array-length-check": "🔧 Use truthiness: if (arr) instead of length check",
		"ts-unnecessary-array-from": "🔧 Iterate directly without Array.from()",
		"ts-redundant-filter-map": "🔧 Use flatMap or single pass transformation",
		"ts-unnecessary-ternary-boolean": "🔧 Use Boolean(cond) or cond directly",
		"ts-typeof-equality": "🤔 Consider instanceof or proper type guards",
		"ts-manual-array-contains": "🔧 Use arr.includes(x) instead of indexOf",
		"ts-slice-copy": "🔧 Use spread [...arr] instead of slice()",
		"ts-parseint-no-radix": "🔧 Add radix: parseInt(x, 10)",
		"ts-isnan-check": "🔧 Use Number.isNaN(x) instead of x !== x",
		"ts-void-zero": "🔧 Use undefined directly instead of void 0",
		"ts-function-constructor": "🏗️ Avoid dynamic code evaluation",
		"ts-unnecessary-bind": "🔧 Remove .bind(this) in arrow function context",
		"ts-empty-array-check": "🔧 Use !arr.length or truthiness",
		"ts-array-every-some": "🔧 Use arr.every(x => !!x.prop) directly",
		"ts-string-split-index": "🔧 Use destructuring or named variables",
		"ts-nested-ternary": "🔧 Extract to if/else or named variables",
		"ts-unnecessary-else-return": "🔧 Remove redundant else after return",
		"ts-object-hasown-check": "🔧 Use Object.hasOwn(obj, key)",
		"ts-delete-property": "🤔 Consider setting to undefined or restructuring",
		"ts-in-operator-loop": "🔧 Use Object.keys/entries/values for iteration",
		"ts-array-concat-spread": "🔧 Use push(...items) or spread directly",
		"ts-unnecessary-array-isarray": "🔧 Remove redundant Array.isArray check",
		"ts-nullish-coalescing-opportunity": "🔧 Use x ?? default instead of ternary",
		"ts-optional-chaining-default": "🔧 Use obj?.prop ?? default",
	};
	
	return instructions[issue.rule] || "🤔 Evaluate: fix if trivial, mark FP if rule is wrong";
}

// --- Handler ---
export async function handleFixSimplified(
	args: string,
	ctx: ExtensionContext,
	clients: FixClients,
	pi: ExtensionAPI,
) {
	const cwd = ctx.cwd || process.cwd();

	// Parse command args: supports "[path] [--false-positive 'type:file:line']"
	const argsTrimmed = args.trim();
	let targetPath = ".";
	let falsePositive: string | undefined;

	if (argsTrimmed) {
		// Check for --false-positive flag
		const fpMatch = argsTrimmed.match(/--false-positive\s+['"]?([^'"\s]+)['"]?/);
		if (fpMatch) {
			falsePositive = fpMatch[1];
			targetPath = argsTrimmed.replace(fpMatch[0], "").trim() || ".";
		} else {
			targetPath = argsTrimmed;
		}
	}

	// Handle false positive marking
	if (falsePositive) {
		const ignores = loadIgnoreFile(cwd);
		ignores.push({
			pattern: falsePositive,
			addedAt: new Date().toISOString(),
			reason: "User marked as false positive",
		});
		saveIgnoreFile(cwd, ignores);
		ctx.ui.notify(`Marked ${falsePositive} as false positive`, "info");
		return;
	}

	// Get changed files
	let files: string[];
	if (targetPath !== "." && nodeFs.existsSync(targetPath)) {
		files = [targetPath];
	} else {
		files = getChangedFiles(cwd);
	}

	if (files.length === 0) {
		ctx.ui.notify(
			"No changed files found. Edit some files first, or specify a path.",
			"warning",
		);
		return;
	}

	// Apply file-level exclusions
	const filesToScan = files.filter(shouldScanFile);
	const skippedCount = files.length - filesToScan.length;

	ctx.ui.notify(
		`Analyzing ${filesToScan.length} file(s)${skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}...`,
		"info",
	);

	// Load ignores
	const ignores = loadIgnoreFile(cwd);

	// STEP 1: Auto-fix with Biome (silent - no reporting of these issues)
	let biomeFixed = 0;
	if (clients.biome.isAvailable()) {
		ctx.ui.notify("🔧 Running Biome auto-fix...", "info");
		biomeFixed = await autoFixWithBiome(files, clients);
		if (biomeFixed > 0) {
			ctx.ui.notify(`✅ Biome auto-fixed ${biomeFixed} issue(s)`, "info");
		}
	}

	// STEP 2: Detect structural issues with AST-grep (these need human decisions)
	const structuralIssues = await detectStructuralIssues(filesToScan, cwd, ignores, clients);

	// STEP 3: Apply safe ast-grep fixes that biome doesn't handle
	let astGrepFixed = 0;
	if (structuralIssues.length > 0) {
		astGrepFixed = await applySafeAstGrepFixes(structuralIssues, cwd);
		if (astGrepFixed > 0) {
			ctx.ui.notify(`🤖 Fixed ${astGrepFixed} structural issue(s)`, "info");
		}
	}

	const totalFixed = biomeFixed + astGrepFixed;

	// If no structural issues remain, just confirm success
	if (structuralIssues.length === 0) {
		ctx.ui.notify(
			`✅ /lens-booboo-fix complete — ${totalFixed} issue(s) auto-fixed, no structural issues remain.`,
			"info",
		);
		return;
	}

	// Generate imperative prompt for AI to fix remaining issues
	const actionPrompt = generateActionPrompt(structuralIssues, totalFixed, filesToScan, cwd);
	
	// Send the prompt to the AI via pi's message API
	// This triggers the AI to respond and act on the issues
	pi.sendUserMessage(actionPrompt);
}
