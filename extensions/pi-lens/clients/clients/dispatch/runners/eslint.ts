/**
 * ESLint runner for dispatch system
 *
 * Runs ESLint on JS/TS files when an ESLint config is present in the project.
 * Prefers the local node_modules installation over global.
 *
 * Gate: skips when no ESLint config is detected (project uses Biome/OxLint instead).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePackagePath } from "../../package-root.js";
import { safeSpawnAsync } from "../../safe-spawn.js";
import type {
	Diagnostic,
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";

const ESLINT_CONFIGS = [
	".eslintrc",
	".eslintrc.js",
	".eslintrc.cjs",
	".eslintrc.json",
	".eslintrc.yaml",
	".eslintrc.yml",
	"eslint.config.js",
	"eslint.config.mjs",
	"eslint.config.cjs",
];

function hasEslintConfig(cwd: string): boolean {
	for (const cfg of ESLINT_CONFIGS) {
		if (fs.existsSync(path.join(cwd, cfg))) return true;
	}
	try {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(cwd, "package.json"), "utf-8"),
		);
		if (pkg.eslintConfig) return true;
	} catch {}
	return false;
}

function isJavaScriptFamily(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	return ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs";
}

function findEslint(cwd: string): string {
	const isWin = process.platform === "win32";
	const local = path.join(
		cwd,
		"node_modules",
		".bin",
		isWin ? "eslint.cmd" : "eslint",
	);
	if (fs.existsSync(local)) return local;
	// fall back to global
	return "eslint";
}

interface EslintMessage {
	ruleId: string | null;
	severity: 1 | 2;
	message: string;
	line: number;
	column: number;
	fix?: unknown;
}

interface EslintFileResult {
	filePath: string;
	messages: EslintMessage[];
}

function parseEslintJson(raw: string, filePath: string): Diagnostic[] {
	try {
		const results: EslintFileResult[] = JSON.parse(raw);
		const diagnostics: Diagnostic[] = [];

		for (const fileResult of results) {
			for (const msg of fileResult.messages) {
				const severity = msg.severity === 2 ? "error" : "warning";
				diagnostics.push({
					id: `eslint:${msg.ruleId ?? "unknown"}:${msg.line}`,
					message: msg.ruleId ? `${msg.ruleId}: ${msg.message}` : msg.message,
					filePath,
					line: msg.line ?? 1,
					column: msg.column ?? 1,
					severity,
					semantic: severity === "error" ? "blocking" : "warning",
					tool: "eslint",
					rule: msg.ruleId ?? undefined,
					fixable: !!msg.fix,
				});
			}
		}

		return diagnostics;
	} catch {
		return [];
	}
}

const eslintRunner: RunnerDefinition = {
	id: "eslint",
	appliesTo: ["jsts"],
	priority: 12,
	enabledByDefault: true,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		const cwd = ctx.cwd || process.cwd();
		const userHasConfig = hasEslintConfig(cwd);
		const useBundledCore = !!ctx.pi.getFlag("lens-eslint-core") && !userHasConfig;

		// Default mode: only run if project has an ESLint config.
		// Optional fallback mode: use bundled JS-only core rules.
		if (!userHasConfig && !useBundledCore) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		if (useBundledCore && !isJavaScriptFamily(ctx.filePath)) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		const cmd = findEslint(cwd);

		// Verify ESLint is actually executable
		const versionCheck = await safeSpawnAsync(cmd, ["--version"], {
			timeout: 5000,
			cwd,
		});
		if (versionCheck.error || versionCheck.status !== 0) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		const configArgs = useBundledCore
			? [
					"--config",
					resolvePackagePath(import.meta.url, "config", "eslint", "core.mjs"),
				]
			: [];

		const result = await safeSpawnAsync(
			cmd,
			[
				"--format",
				"json",
				"--no-error-on-unmatched-pattern",
				...configArgs,
				ctx.filePath,
			],
			{ timeout: 30000, cwd },
		);

		// ESLint exits 1 when there are lint errors, 2 on fatal/config error
		if (result.status === 2) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		const raw = result.stdout || result.stderr || "";

		if (result.status === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		const diagnostics = parseEslintJson(raw, ctx.filePath);
		if (diagnostics.length === 0) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		const hasErrors = diagnostics.some((d) => d.semantic === "blocking");
		return {
			status: "failed",
			diagnostics,
			semantic: hasErrors ? "blocking" : "warning",
		};
	},
};

export default eslintRunner;
