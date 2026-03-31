import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { DispatchContext } from "../types.js";

function createMockContext(filePath: string): DispatchContext {
	return {
		filePath,
		cwd: process.cwd(),
		kind: "python" as any,
		autofix: false,
		deltaMode: false,
		baselines: { get: () => [], add: () => {}, save: () => {} } as any,
		pi: {} as any,
		hasTool: async () => false,
		log: () => {},
	};
}

// Helper for safe file cleanup
function safeUnlink(filePath: string): void {
	try {
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	} catch {
		// Ignore cleanup errors on Windows
	}
}

describe("python-slop runner", () => {
	const require = createRequire(import.meta.url);

	it("should have correct runner definition", async () => {
		const slopModule = await import("./python-slop.js");
		const runner = slopModule.default;

		expect(runner.id).toBe("python-slop");
		expect(runner.appliesTo).toEqual(["python"]);
		expect(runner.priority).toBe(25);
		expect(runner.enabledByDefault).toBe(true);
		expect(runner.skipTestFiles).toBe(true);
	});

	it("should detect ast-grep availability", () => {
		const { spawnSync } =
			require("node:child_process") as typeof import("node:child_process");
		const result = spawnSync("npx", ["sg", "--version"], {
			encoding: "utf-8",
			timeout: 10000,
			shell: true,
		});
		expect(
			result.error || result.status !== 0 ? "not available" : "available",
		).toBe("available");
	});

	it("should detect verbose range-len pattern", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`slop_test_range_${Date.now()}.py`,
		);
		fs.writeFileSync(
			tmpFile,
			`# Slop: using range(len()) instead of enumerate
def process_items(items):
    for i in range(len(items)):
        print(items[i])
`,
		);

		try {
			const slopModule = await import("./python-slop.js");
			const runner = slopModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
			expect(
				result.diagnostics.some(
					(d) =>
						d.tool === "python-slop" &&
						d.message.includes("range(len") &&
						d.message.includes("enumerate"),
				),
			).toBe(true);
		} finally {
			safeUnlink(tmpFile);
		}
	});

	it("should detect manual min/max pattern", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`slop_test_minmax_${Date.now()}.py`,
		);
		fs.writeFileSync(
			tmpFile,
			`# Slop: manual min/max instead of built-in
def find_max(a, b):
    if a > b:
        m = a
    else:
        m = b
    return m
`,
		);

		try {
			const slopModule = await import("./python-slop.js");
			const runner = slopModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
			expect(
				result.diagnostics.some(
					(d) =>
						d.tool === "python-slop" &&
						(d.message.includes("min") || d.message.includes("max")),
				),
			).toBe(true);
		} finally {
			safeUnlink(tmpFile);
		}
	});

	it("should detect defensive None guard", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`slop_test_guard_${Date.now()}.py`,
		);
		fs.writeFileSync(
			tmpFile,
			`# Slop: defensive None guard
def process(data):
    if data is None:
        return None
    return data.upper()
`,
		);

		try {
			const slopModule = await import("./python-slop.js");
			const runner = slopModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
			expect(
				result.diagnostics.some(
					(d) =>
						d.tool === "python-slop" &&
						(d.message.includes("defensive") ||
							d.message.includes("guard")),
				),
			).toBe(true);
		} finally {
			safeUnlink(tmpFile);
		}
	});

	it("should detect list comprehension ceremony", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`slop_test_list_${Date.now()}.py`,
		);
		fs.writeFileSync(
			tmpFile,
			`# Slop: redundant list comprehension
def convert(items):
    return [x for x in items]
`,
		);

		try {
			const slopModule = await import("./python-slop.js");
			const runner = slopModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
			expect(
				result.diagnostics.some(
					(d) =>
						d.tool === "python-slop" &&
						d.message.includes("list") &&
						d.message.includes("unnecessary"),
				),
			).toBe(true);
		} finally {
			safeUnlink(tmpFile);
		}
	});

	it("should detect chained comparison opportunity", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`slop_test_chain_${Date.now()}.py`,
		);
		fs.writeFileSync(
			tmpFile,
			`# Slop: could use chained comparison
def check_range(x, a, b):
    return a < x and x < b
`,
		);

		try {
			const slopModule = await import("./python-slop.js");
			const runner = slopModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
			expect(
				result.diagnostics.some(
					(d) =>
						d.tool === "python-slop" &&
						d.message.includes("chained"),
				),
			).toBe(true);
		} finally {
			safeUnlink(tmpFile);
		}
	});

	it("should pass clean Python files", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`slop_test_ok_${Date.now()}.py`,
		);
		fs.writeFileSync(
			tmpFile,
			`# Clean Python code
def process_items(items):
    """Process items using proper Python idioms."""
    for i, item in enumerate(items):
        print(f"{i}: {item}")

def find_max(a, b):
    return max(a, b)

def check_range(x, min_val, max_val):
    return min_val < x < max_val

def convert(items):
    return list(items)
`,
		);

		try {
			const slopModule = await import("./python-slop.js");
			const runner = slopModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			// Should have no slop issues
			const slopIssues = result.diagnostics.filter(
				(d) => d.tool === "python-slop",
			);
			expect(slopIssues.length).toBe(0);
		} finally {
			safeUnlink(tmpFile);
		}
	});

	it("should categorize by weight correctly", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`slop_test_weight_${Date.now()}.py`,
		);
		fs.writeFileSync(
			tmpFile,
			`# Multiple slop patterns - weight 3 and weight 4
def bad_code(items):
    # Weight 3: range(len)
    for i in range(len(items)):
        print(items[i])
    
    # Weight 3: redundant list comprehension  
    return [x for x in items]
`,
		);

		try {
			const slopModule = await import("./python-slop.js");
			const runner = slopModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			// Should detect at least the range(len) pattern
			expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
			
			// All should be warnings (weight 3)
			const warnings = result.diagnostics.filter(
				(d) => d.severity === "warning",
			);
			expect(warnings.length).toBeGreaterThanOrEqual(1);
		} finally {
			safeUnlink(tmpFile);
		}
	});
});
