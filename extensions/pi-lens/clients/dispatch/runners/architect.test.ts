import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { DispatchContext } from "../types.ts";

function createMockContext(
	filePath: string,
	kind: "jsts" | "python" | "go" | "rust" = "jsts",
	cwd?: string,
): DispatchContext {
	return {
		filePath,
		cwd: cwd || process.cwd(),
		kind,
		autofix: false,
		deltaMode: false,
		baselines: { get: () => undefined, set: () => {}, clear: () => {} } as any,
		pi: { getFlag: () => false } as any,
		hasTool: async () => false,
		log: () => {},
	};
}

describe("architect runner", () => {
	const testDir = path.join(process.env.TEMP || "/tmp", `architect_test_${Date.now()}`);
	const configPath = path.join(testDir, ".pi-lens", "architect.yaml");

	beforeAll(() => {
		// Create test config
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(
			configPath,
			`version: "1.0"
rules:
  - pattern: "**/*.ts"
    max_lines: 50
    must_not:
      - pattern: 'hardcoded_secret_12345'
        message: "No hardcoded secrets"
        fix: "Use process.env.SECRET"
      - pattern: 'console\.log'
        message: "No console.log in production"
`,
		);
	});

	afterAll(() => {
		try {
			if (fs.existsSync(testDir)) {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		} catch {
			// Ignore cleanup errors
		}
	});

	it("should load default config when no user config exists", async () => {
		const module = await import("./architect.ts");
		const runner = module.default;

		// Use a unique temp dir with no user config (will fall back to default)
		const noUserConfigDir = path.join(process.env.TEMP || "/tmp", `no_arch_user_config_${Date.now()}`);
		fs.mkdirSync(noUserConfigDir, { recursive: true });

		// Create a very large file that should trigger default max_lines rule
		const tmpFile = path.join(noUserConfigDir, `large_${Date.now()}.ts`);
		fs.writeFileSync(tmpFile, Array(5000).fill("// line").join("\n"));

		try {
			const result = await runner.run(
				createMockContext(tmpFile, "jsts", noUserConfigDir),
			);
			// Should use default config and find violations
			expect(result.status).toBe("succeeded");
			// Should have size violation from default config
			expect(result.diagnostics.some((d) => d.message.includes("line limit"))).toBe(true);
		} finally {
			try {
				if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
				if (fs.existsSync(noUserConfigDir)) fs.rmdirSync(noUserConfigDir);
			} catch {}
		}
	});

	it("should detect file size violations", async () => {
		const module = await import("./architect.ts");
		const runner = module.default;

		const tmpFile = path.join(testDir, `large_file_${Date.now()}.ts`);
		// Create file with 100 lines (exceeds 50 line limit)
		fs.writeFileSync(tmpFile, Array(100).fill("// line").join("\n"));

		try {
			const result = await runner.run(createMockContext(tmpFile, "jsts", testDir));
			expect(result.status).toBe("succeeded");
			expect(result.diagnostics.length).toBeGreaterThan(0);
			expect(result.diagnostics.some((d) => d.message.includes("50 line limit"))).toBe(
				true,
			);
		} finally {
			try {
				if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
			} catch {}
		}
	});

	it("should detect pattern violations", async () => {
		const module = await import("./architect.ts");
		const runner = module.default;

		const tmpFile = path.join(testDir, `bad_patterns_${Date.now()}.ts`);
		fs.writeFileSync(
			tmpFile,
			`const x = hardcoded_secret_12345;
console.log(x);
`,
		);

		try {
			const result = await runner.run(createMockContext(tmpFile, "jsts", testDir));
			expect(result.status).toBe("succeeded");
			expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
			expect(
				result.diagnostics.some((d) => d.message.includes("hardcoded")),
			).toBe(true);
			expect(
				result.diagnostics.some((d) => d.message.includes("console.log")),
			).toBe(true);
		} finally {
			try {
				if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
			} catch {}
		}
	});

	it("should return no diagnostics for clean files", async () => {
		const module = await import("./architect.ts");
		const runner = module.default;

		const tmpFile = path.join(testDir, `clean_${Date.now()}.ts`);
		// Small file (20 lines) with no violations
		fs.writeFileSync(tmpFile, Array(20).fill("// clean code").join("\n"));

		try {
			const result = await runner.run(createMockContext(tmpFile, "jsts", testDir));
			expect(result.status).toBe("succeeded");
			expect(result.diagnostics.length).toBe(0);
		} finally {
			try {
				if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
			} catch {}
		}
	});

	it("should skip test files", async () => {
		const module = await import("./architect.ts");
		const runner = module.default;

		// The runner should have skipTestFiles: true
		expect(runner.skipTestFiles).toBe(true);
	});
});
