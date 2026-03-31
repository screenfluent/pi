/**
 * Formatter Definitions for pi-lens
 *
 * Auto-detects formatters based on:
 * - Config files (biome.json, .prettierrc, etc.)
 * - Dependencies (package.json, requirements.txt, etc.)
 * - Binary availability (which/where)
 *
 * Inspired by OpenCode's formatter.ts pattern
 */

import * as path from "path";
import * as fs from "fs/promises";
import { safeSpawn } from "./safe-spawn.js";

// --- Types ---

export interface FormatterInfo {
	name: string;
	command: string[]; // Command with $FILE placeholder
	extensions: string[];
	/** Detect if this formatter should be used for a project */
	detect(cwd: string): Promise<boolean>;
}

export interface FormatterResult {
	success: boolean;
	changed: boolean;
	error?: string;
}

// --- Utility Functions ---

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function findUp(
	targets: string[],
	startDir: string,
	stopDir: string = path.parse(startDir).root
): Promise<string[]> {
	const found: string[] = [];
	let currentDir = startDir;

	while (currentDir !== stopDir) {
		for (const target of targets) {
			const checkPath = path.join(currentDir, target);
			if (await fileExists(checkPath)) {
				found.push(checkPath);
			}
		}
		const parent = path.dirname(currentDir);
		if (parent === currentDir) break;
		currentDir = parent;
	}

	return found;
}

async function readJson(filePath: string): Promise<unknown> {
	try {
		const content = await fs.readFile(filePath, "utf-8");
		return JSON.parse(content);
	} catch {
		return {};
	}
}

async function which(command: string): Promise<string | null> {
	const result = safeSpawn(
		process.platform === "win32" ? "where" : "which",
		[command],
		{ timeout: 5000 }
	);
	if (result.error || result.status !== 0) return null;
	return result.stdout?.trim().split("\n")[0] ?? null;
}

// --- Formatter Definitions ---

export const biomeFormatter: FormatterInfo = {
	name: "biome",
	command: ["npx", "@biomejs/biome", "format", "--write", "$FILE"],
	extensions: [
		".js", ".jsx", ".mjs", ".cjs",
		".ts", ".tsx", ".mts", ".cts",
		".json", ".jsonc",
		".css", ".scss", ".sass",
		".vue", ".svelte",
		".html", ".htm"
	],
	async detect(cwd: string) {
		const configs = ["biome.json", "biome.jsonc"];
		const found = await findUp(configs, cwd);
		if (found.length > 0) return true;

		// Also check if biome is in package.json devDependencies
		const pkgPath = path.join(cwd, "package.json");
		if (await fileExists(pkgPath)) {
			const pkg = await readJson(pkgPath) as { devDependencies?: Record<string, string> };
			if (pkg.devDependencies?.["@biomejs/biome"]) return true;
		}

		return false;
	},
};

export const prettierFormatter: FormatterInfo = {
	name: "prettier",
	command: ["npx", "prettier", "--write", "$FILE"],
	extensions: [
		".js", ".jsx", ".mjs", ".cjs",
		".ts", ".tsx", ".mts", ".cts",
		".json", ".jsonc",
		".css", ".scss", ".sass", ".less",
		".vue", ".svelte",
		".html", ".htm",
		".md", ".mdx",
		".yaml", ".yml",
		".graphql", ".gql"
	],
	async detect(cwd: string) {
		// Check for prettier config files
		const configs = [
			".prettierrc", ".prettierrc.json", ".prettierrc.yml",
			".prettierrc.yaml", ".prettierrc.js", ".prettierrc.cjs",
			"prettier.config.js", "prettier.config.cjs"
		];
		const found = await findUp(configs, cwd);
		if (found.length > 0) return true;

		// Check package.json
		const pkgPath = path.join(cwd, "package.json");
		if (await fileExists(pkgPath)) {
			const pkg = await readJson(pkgPath) as {
				devDependencies?: Record<string, string>,
				dependencies?: Record<string, string>,
				prettier?: unknown
			};
			if (pkg.devDependencies?.["prettier"] || pkg.dependencies?.["prettier"]) {
				return true;
			}
			// Also check if "prettier" field exists in package.json
			if (pkg.prettier !== undefined) return true;
		}

		return false;
	},
};

export const ruffFormatter: FormatterInfo = {
	name: "ruff",
	command: ["ruff", "format", "$FILE"],
	extensions: [".py", ".pyi"],
	async detect(cwd: string) {
		// Check for ruff config
		const configs = ["pyproject.toml", "ruff.toml", ".ruff.toml"];
		const found = await findUp(configs, cwd);

		for (const configPath of found) {
			if (configPath.endsWith("pyproject.toml")) {
				const content = await fs.readFile(configPath, "utf-8");
				if (content.includes("[tool.ruff]")) return true;
			} else {
				return true; // ruff.toml or .ruff.toml found
			}
		}

		// Check if ruff in requirements
		const deps = ["requirements.txt", "pyproject.toml", "Pipfile"];
		for (const dep of deps) {
			const depPath = path.join(cwd, dep);
			if (await fileExists(depPath)) {
				const content = await fs.readFile(depPath, "utf-8");
				if (content.includes("ruff")) return true;
			}
		}

		// Check if ruff binary available and no other Python formatter detected
		const hasRuff = await which("ruff") !== null;
		if (hasRuff) {
			// Prefer ruff if no black config found
			const blackFound = await findUp(["pyproject.toml"], cwd);
			for (const p of blackFound) {
				const content = await fs.readFile(p, "utf-8");
				if (content.includes("[tool.black]")) return false; // Prefer black if configured
			}
			return true;
		}

		return false;
	},
};

export const blackFormatter: FormatterInfo = {
	name: "black",
	command: ["black", "$FILE"],
	extensions: [".py", ".pyi"],
	async detect(cwd: string) {
		// Check for black config in pyproject.toml
		const configs = ["pyproject.toml"];
		const found = await findUp(configs, cwd);
		for (const configPath of found) {
			const content = await fs.readFile(configPath, "utf-8");
			if (content.includes("[tool.black]")) return true;
		}

		// Check if black in requirements
		const deps = ["requirements.txt", "pyproject.toml", "Pipfile"];
		for (const dep of deps) {
			const depPath = path.join(cwd, dep);
			if (await fileExists(depPath)) {
				const content = await fs.readFile(depPath, "utf-8");
				if (content.toLowerCase().includes("black")) return true;
			}
		}

		return false;
	},
};

export const gofmtFormatter: FormatterInfo = {
	name: "gofmt",
	command: ["gofmt", "-w", "$FILE"],
	extensions: [".go"],
	async detect(cwd: string) {
		return (await which("gofmt")) !== null;
	},
};

export const rustfmtFormatter: FormatterInfo = {
	name: "rustfmt",
	command: ["rustfmt", "$FILE"],
	extensions: [".rs"],
	async detect(cwd: string) {
		return (await which("rustfmt")) !== null;
	},
};

export const zigFormatter: FormatterInfo = {
	name: "zig",
	command: ["zig", "fmt", "$FILE"],
	extensions: [".zig", ".zon"],
	async detect(cwd: string) {
		return (await which("zig")) !== null;
	},
};

export const dartFormatter: FormatterInfo = {
	name: "dart",
	command: ["dart", "format", "$FILE"],
	extensions: [".dart"],
	async detect(cwd: string) {
		return (await which("dart")) !== null;
	},
};

export const shfmtFormatter: FormatterInfo = {
	name: "shfmt",
	command: ["shfmt", "-w", "$FILE"],
	extensions: [".sh", ".bash"],
	async detect(cwd: string) {
		return (await which("shfmt")) !== null;
	},
};

export const nixfmtFormatter: FormatterInfo = {
	name: "nixfmt",
	command: ["nixfmt", "$FILE"],
	extensions: [".nix"],
	async detect(cwd: string) {
		return (await which("nixfmt")) !== null;
	},
};

export const mixFormatter: FormatterInfo = {
	name: "mix",
	command: ["mix", "format", "$FILE"],
	extensions: [".ex", ".exs", ".eex", ".heex", ".leex"],
	async detect(cwd: string) {
		return (await which("mix")) !== null;
	},
};

export const ocamlformatFormatter: FormatterInfo = {
	name: "ocamlformat",
	command: ["ocamlformat", "-i", "$FILE"],
	extensions: [".ml", ".mli"],
	async detect(cwd: string) {
		const hasBinary = (await which("ocamlformat")) !== null;
		if (!hasBinary) return false;
		const configs = [".ocamlformat"];
		const found = await findUp(configs, cwd);
		return found.length > 0;
	},
};

export const clangFormatFormatter: FormatterInfo = {
	name: "clang-format",
	command: ["clang-format", "-i", "$FILE"],
	extensions: [".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".ino"],
	async detect(cwd: string) {
		const hasBinary = (await which("clang-format")) !== null;
		if (!hasBinary) return false;
		const configs = [".clang-format", "_clang-format"];
		const found = await findUp(configs, cwd);
		return found.length > 0;
	},
};

export const ktlintFormatter: FormatterInfo = {
	name: "ktlint",
	command: ["ktlint", "-F", "$FILE"],
	extensions: [".kt", ".kts"],
	async detect(cwd: string) {
		return (await which("ktlint")) !== null;
	},
};

export const terraformFormatter: FormatterInfo = {
	name: "terraform",
	command: ["terraform", "fmt", "$FILE"],
	extensions: [".tf", ".tfvars"],
	async detect(cwd: string) {
		return (await which("terraform")) !== null;
	},
};

// --- Registry ---

const ALL_FORMATTERS: FormatterInfo[] = [
	biomeFormatter,
	prettierFormatter,
	ruffFormatter,
	blackFormatter,
	gofmtFormatter,
	rustfmtFormatter,
	zigFormatter,
	dartFormatter,
	shfmtFormatter,
	nixfmtFormatter,
	mixFormatter,
	ocamlformatFormatter,
	clangFormatFormatter,
	ktlintFormatter,
	terraformFormatter,
];

// Cache for detection results
const detectionCache = new Map<string, Map<string, boolean>>();

// --- Public API ---

export async function getFormattersForFile(
	filePath: string,
	cwd: string
): Promise<FormatterInfo[]> {
	const ext = path.extname(filePath).toLowerCase();
	const cacheKey = `${cwd}:${ext}`;

	// Check cache
	let cached = detectionCache.get(cwd);
	if (!cached) {
		cached = new Map();
		detectionCache.set(cwd, cached);
	}

	if (cached.has(cacheKey)) {
		const enabled = cached.get(cacheKey);
		if (!enabled) return [];
		// Return cached formatters
		return ALL_FORMATTERS.filter(f => f.extensions.includes(ext));
	}

	// Detect formatters for this extension
	const matching = ALL_FORMATTERS.filter(f => f.extensions.includes(ext));
	const enabled: FormatterInfo[] = [];

	for (const formatter of matching) {
		try {
			const isEnabled = await formatter.detect(cwd);
			if (isEnabled) {
				enabled.push(formatter);
			}
		} catch (err) {
			// Detection failed, skip this formatter
			console.error(`[format] Detection failed for ${formatter.name}:`, err);
		}
	}

	cached.set(cacheKey, enabled.length > 0);
	return enabled;
}

export function clearFormatterCache(): void {
	detectionCache.clear();
}

export async function formatFile(
	filePath: string,
	formatter: FormatterInfo
): Promise<FormatterResult> {
	try {
		const absolutePath = path.resolve(filePath);
		const contentBefore = await fs.readFile(absolutePath, "utf-8");

		// Replace $FILE placeholder
		const cmd = formatter.command.map(c => c.replace("$FILE", absolutePath));

		// Run formatter
		const result = safeSpawn(cmd[0], cmd.slice(1), { timeout: 15000 });

		if (result.error) {
			return {
				success: false,
				changed: false,
				error: result.error.message,
			};
		}

		// Check if content changed
		const contentAfter = await fs.readFile(absolutePath, "utf-8");
		const changed = contentBefore !== contentAfter;

		return {
			success: true,
			changed,
		};
	} catch (err) {
		return {
			success: false,
			changed: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export function listAllFormatters(): string[] {
	return ALL_FORMATTERS.map(f => f.name);
}
