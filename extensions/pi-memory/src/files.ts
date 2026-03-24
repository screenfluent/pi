/**
 * pi-memory — File operations.
 *
 * Memory lives as plain Markdown on disk:
 *   MEMORY.md            — Curated long-term memory
 *   memory/YYYY-MM-DD.md — Append-only daily logs
 *
 * The base directory defaults to cwd but can be set via settings.json:
 *   { "pi-memory": { "path": "/custom/path" } }
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── State ───────────────────────────────────────────────────────

let globalBasePath: string = process.cwd();
let projectBasePath: string | null = null;

export function setGlobalBasePath(p: string): void {
	globalBasePath = p;
}

export function setProjectBasePath(p: string | null): void {
	projectBasePath = p;
}

/** @deprecated Use setGlobalBasePath instead */
export function setBasePath(p: string): void {
	globalBasePath = p;
}

export function getGlobalBasePath(): string {
	return globalBasePath;
}

export function getProjectBasePath(): string | null {
	return projectBasePath;
}

export function getBasePath(): string {
	return projectBasePath ?? globalBasePath;
}

// ── Paths ───────────────────────────────────────────────────────

export function longTermPath(): string {
	return path.join(basePath, "MEMORY.md");
}

export function memoryDir(): string {
	return path.join(basePath, "memory");
}

export function dailyPath(date?: string): string {
	return path.join(memoryDir(), `${date ?? todayStr()}.md`);
}

// ── Date helpers ────────────────────────────────────────────────

export function todayStr(): string {
	return localDateStr(new Date());
}

export function yesterdayStr(): string {
	const d = new Date();
	d.setDate(d.getDate() - 1);
	return localDateStr(d);
}

function localDateStr(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ── File I/O ────────────────────────────────────────────────────

export function ensureDir(dir: string): void {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readFileOr(filePath: string, fallback = ""): string {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return fallback;
	}
}

export function writeFile(filePath: string, content: string): void {
	ensureDir(path.dirname(filePath));
	fs.writeFileSync(filePath, content, "utf-8");
}

export function appendToFile(filePath: string, content: string): void {
	ensureDir(path.dirname(filePath));
	const existing = readFileOr(filePath);
	const sep = existing && !existing.endsWith("\n") ? "\n" : "";
	fs.writeFileSync(filePath, existing + sep + content + "\n", "utf-8");
}

// ── Daily log listing ───────────────────────────────────────────

export function listDailyFiles(): string[] {
	const dir = memoryDir();
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter(f => f.endsWith(".md"))
		.sort()
		.reverse();
}

// ── Global-scoped paths ─────────────────────────────────────────

export function globalLongTermPath(): string {
	return path.join(globalBasePath, "MEMORY.md");
}

export function globalMemoryDir(): string {
	return path.join(globalBasePath, "memory");
}

export function globalDailyPath(date?: string): string {
	return path.join(globalMemoryDir(), `${date ?? todayStr()}.md`);
}

// ── Project-scoped paths ────────────────────────────────────────

export function projectLongTermPath(): string | null {
	if (!projectBasePath) return null;
	return path.join(projectBasePath, "MEMORY.md");
}

export function projectMemoryDir(): string | null {
	if (!projectBasePath) return null;
	return path.join(projectBasePath, "memory");
}

export function projectDailyPath(date?: string): string | null {
	const dir = projectMemoryDir();
	if (!dir) return null;
	return path.join(dir, `${date ?? todayStr()}.md`);
}

// ── All memory files (for search) ───────────────────────────────

export function allMemoryFiles(): Array<{ label: string; path: string }> {
	const result: Array<{ label: string; path: string }> = [];
	const seen = new Set<string>();

	// Global first
	const gltm = globalLongTermPath();
	if (fs.existsSync(gltm)) { result.push({ label: "global/MEMORY.md", path: gltm }); seen.add(gltm); }
	const gdir = globalMemoryDir();
	if (fs.existsSync(gdir)) {
		for (const f of fs.readdirSync(gdir).filter(f => f.endsWith(".md")).sort().reverse()) {
			const fp = path.join(gdir, f);
			if (!seen.has(fp)) { result.push({ label: `global/memory/${f}`, path: fp }); seen.add(fp); }
		}
	}

	// Project
	const pltm = projectLongTermPath();
	if (pltm && fs.existsSync(pltm) && !seen.has(pltm)) { result.push({ label: "project/MEMORY.md", path: pltm }); seen.add(pltm); }
	const pdir = projectMemoryDir();
	if (pdir && fs.existsSync(pdir)) {
		for (const f of fs.readdirSync(pdir).filter(f => f.endsWith(".md")).sort().reverse()) {
			const fp = path.join(pdir, f);
			if (!seen.has(fp)) { result.push({ label: `project/memory/${f}`, path: fp }); seen.add(fp); }
		}
	}

	return result;
}
