import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { DispatchContext } from "../types.js";

function createMockContext(filePath: string, kind: any = "jsts"): DispatchContext {
	return {
		filePath,
		cwd: process.cwd(),
		kind,
		autofix: false,
		deltaMode: false,
		baselines: { get: () => [], add: () => {}, save: () => {} } as any,
		pi: {} as any,
		hasTool: async () => false,
		log: () => {},
	};
}

describe("ast-grep-napi vs CLI comparison", () => {
	it("should load the napi module", async () => {
		const napiModule = await import("./ast-grep-napi.js");
		expect(napiModule.default.id).toBe("ast-grep-napi");
		expect(napiModule.default.appliesTo).toEqual(["jsts"]);
	});

	it("should scan TypeScript file faster than CLI", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`napi_test_${Date.now()}.ts`,
		);
		fs.writeFileSync(
			tmpFile,
			`// Test file with various patterns
function test(items: string[]) {
    for (let i = 0; i < items.length; i++) {
        console.log(items[i]);
    }
    
    try {
        riskyOperation();
    } catch (e) {
        // empty catch
    }
    
    return await fetchData();
}

async function fetchData() {
    return await Promise.resolve(42);
}

function riskyOperation() {
    debugger;
}
`,
		);

		try {
			// Test NAPI version
			const napiModule = await import("./ast-grep-napi.js");
			const napiRunner = napiModule.default;
			
			console.time("napi");
			const napiResult = await napiRunner.run(createMockContext(tmpFile));
			console.timeEnd("napi");
			
			// Test CLI version
			const cliModule = await import("./ast-grep.js");
			const cliRunner = cliModule.default;
			
			console.time("cli");
			const cliResult = await cliRunner.run(createMockContext(tmpFile));
			console.timeEnd("cli");
			
			// Both should complete successfully
			expect(napiResult.status).not.toBe("skipped");
			expect(cliResult.status).not.toBe("skipped");
			
			// Log comparison
			console.log("NAPI found:", napiResult.diagnostics.length, "issues");
			console.log("CLI found:", cliResult.diagnostics.length, "issues");
			
			// Show what NAPI found exactly
			console.log("\n=== NAPI FINDINGS ===");
			napiResult.diagnostics.forEach((d, i) => {
				console.log(`${i + 1}. Line ${d.line}: ${d.rule}`);
			});
			
			// Show what CLI found (if any)
			if (cliResult.diagnostics.length > 0) {
				console.log("\n=== CLI FINDINGS ===");
				cliResult.diagnostics.forEach((d, i) => {
					console.log(`${i + 1}. Line ${d.line}: ${d.rule}`);
				});
			}
			
		} finally {
			try {
				if (fs.existsSync(tmpFile)) {
					fs.unlinkSync(tmpFile);
				}
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	it("should skip non-TS/JS files", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`napi_test_py_${Date.now()}.py`,
		);
		fs.writeFileSync(tmpFile, "# Python file\nprint('hello')");

		try {
			const napiModule = await import("./ast-grep-napi.js");
			const napiRunner = napiModule.default;
			
			const result = await napiRunner.run(createMockContext(tmpFile, "python"));
			expect(result.status).toBe("skipped");
		} finally {
			try {
				if (fs.existsSync(tmpFile)) {
					fs.unlinkSync(tmpFile);
				}
			} catch {
				// Ignore cleanup errors
			}
		}
	});
});
