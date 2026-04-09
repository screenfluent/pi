import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { DispatchContext } from "../types.ts";

// Find all TS files
function findTsFiles(dir: string): string[] {
	const files: string[] = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		
		// Skip node_modules, .git, etc
		if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".pi-lens") {
			continue;
		}
		
		if (entry.isDirectory()) {
			files.push(...findTsFiles(fullPath));
		} else if (entry.isFile() && fullPath.endsWith(".ts") && !fullPath.endsWith(".test.ts")) {
			files.push(fullPath);
		}
	}
	
	return files;
}

function createContext(filePath: string): DispatchContext {
	return {
		filePath,
		cwd: process.cwd(),
		kind: "jsts",
		autofix: false,
		deltaMode: false,
		baselines: { get: () => [], add: () => {}, save: () => {} } as any,
		pi: {} as any,
		hasTool: async () => false,
		log: () => {},
	};
}

describe("Codebase scan with NAPI runner", () => {
	it("should scan all TypeScript files and report findings", async () => {
		const tsFiles = findTsFiles(process.cwd());
		console.log(`\nFound ${tsFiles.length} TypeScript files to scan\n`);
		
		const runner = (await import("./ast-grep-napi.ts")).default;
		
		const allIssues: Array<{ file: string; line: number; rule: string; message: string }> = [];
		let totalTime = 0;
		let filesWithIssues = 0;
		
		for (let i = 0; i < Math.min(tsFiles.length, 50); i++) { // Limit to 50 for test speed
			const file = tsFiles[i];
			const ctx = createContext(file);
			
			const start = Date.now();
			const result = await runner.run(ctx);
			const elapsed = Date.now() - start;
			totalTime += elapsed;
			
			if (result.diagnostics.length > 0) {
				filesWithIssues++;
				console.log(`${path.relative(process.cwd(), file)} (${elapsed}ms):`);
				for (const d of result.diagnostics.slice(0, 5)) { // Show max 5 per file
					const line = d.line ?? 0;
					const rule = d.rule ?? "unknown";
					const message = d.message?.split('\n')[0] ?? "";
					console.log(`  Line ${line}: [${rule}] ${message}`);
					allIssues.push({
						file: path.relative(process.cwd(), file),
						line,
						rule,
						message,
					});
				}
				if (result.diagnostics.length > 5) {
					console.log(`  ... and ${result.diagnostics.length - 5} more`);
				}
			}
		}
		
		console.log(`\n=== SUMMARY (first 50 files) ===`);
		console.log(`Files scanned: ${Math.min(tsFiles.length, 50)}/${tsFiles.length}`);
		console.log(`Total time: ${totalTime}ms`);
		console.log(`Files with issues: ${filesWithIssues}`);
		console.log(`Total issues: ${allIssues.length}`);
		console.log(`Avg time per file: ${(totalTime / Math.min(tsFiles.length, 50)).toFixed(1)}ms`);
		
		// Group by rule
		const byRule: Record<string, number> = {};
		for (const issue of allIssues) {
			byRule[issue.rule] = (byRule[issue.rule] || 0) + 1;
		}
		
		console.log(`\n=== BY RULE ===`);
		for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
			console.log(`  ${rule}: ${count}`);
		}
		
		// This test should pass - we're just scanning
		expect(true).toBe(true);
	}, 60000); // 60 second timeout for scanning
});
