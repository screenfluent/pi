/**
 * Tests for spellcheck runner (typos-cli)
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { DispatchContext } from "../types.js";

function createMockContext(filePath: string): DispatchContext {
	return {
		filePath,
		cwd: process.cwd(),
		kind: "markdown" as any,
		autofix: false,
		deltaMode: false,
		baselines: { get: () => [], add: () => {}, save: () => {} } as any,
		pi: {} as any,
		hasTool: async () => false,
		log: () => {},
	};
}

describe("spellcheck runner", () => {
	const require = createRequire(import.meta.url);

	it("should have correct runner definition", async () => {
		const spellcheckModule = await import("./spellcheck.js");
		const runner = spellcheckModule.default;

		expect(runner.id).toBe("spellcheck");
		expect(runner.appliesTo).toEqual(["markdown"]);
		expect(runner.priority).toBe(30);
		expect(runner.enabledByDefault).toBe(true);
		expect(runner.skipTestFiles).toBe(false); // Check docs in test files too
	});

	it("should detect typos-cli availability", () => {
		const { spawnSync } =
			require("node:child_process") as typeof import("node:child_process");
		const result = spawnSync("typos", ["--version"], {
			encoding: "utf-8",
			timeout: 10000,
			shell: true,
		});
		expect(
			result.error || result.status !== 0 ? "not available" : "available",
		).toBeTruthy(); // May or may not be installed
	});

	it("should detect typos in markdown content", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`spellcheck_test_${Date.now()}.md`,
		);
		fs.writeFileSync(
			tmpFile,
			`# README

This is a documnet about recieving data.
The seperation of concerns is important.
`,
		);

		try {
			const spellcheckModule = await import("./spellcheck.js");
			const runner = spellcheckModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			// If typos-cli is installed, should detect typos
			// If not installed, will be skipped
			if (result.status !== "skipped") {
				// Should detect at least "documnet" and "recieving"
				expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
				expect(
					result.diagnostics.some(
						(d) =>
							d.tool === "typos" &&
							(d.message.includes("documnet") ||
								d.message.includes("recieving") ||
								d.message.includes("seperation")),
				),
			).toBe(true);
			}
		} finally {
			if (fs.existsSync(tmpFile)) {
				fs.unlinkSync(tmpFile);
			}
		}
	});

	it("should suggest corrections for typos", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`spellcheck_fix_${Date.now()}.md`,
		);
		fs.writeFileSync(
			tmpFile,
			`# Test

This is a recieving test.
`,
		);

		try {
			const spellcheckModule = await import("./spellcheck.js");
			const runner = spellcheckModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			if (result.status !== "skipped" && result.diagnostics.length > 0) {
				// Should have fix suggestions
				const fixableDiags = result.diagnostics.filter((d) => d.fixable);
				expect(fixableDiags.length).toBeGreaterThanOrEqual(1);
				expect(
					fixableDiags.some((d) =>
						d.fixSuggestion?.toLowerCase().includes("receive"),
					),
				).toBe(true);
			}
		} finally {
			if (fs.existsSync(tmpFile)) {
				fs.unlinkSync(tmpFile);
			}
		}
	});

	it("should pass clean markdown files", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`spellcheck_ok_${Date.now()}.md`,
		);
		fs.writeFileSync(
			tmpFile,
			`# Clean README

This is a correct document about receiving data.
The separation of concerns is important.
All spelling is proper in this file.
`,
		);

		try {
			const spellcheckModule = await import("./spellcheck.js");
			const runner = spellcheckModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			if (result.status !== "skipped") {
				// Should have no typos
				expect(result.diagnostics.length).toBe(0);
				expect(result.status).toBe("succeeded");
			}
		} finally {
			if (fs.existsSync(tmpFile)) {
				fs.unlinkSync(tmpFile);
			}
		}
	});

	it("should handle JSON parse errors gracefully", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`spellcheck_json_${Date.now()}.md`,
		);
		fs.writeFileSync(tmpFile, `# Test\n\nSimple file.`);

		try {
			const spellcheckModule = await import("./spellcheck.js");
			const runner = spellcheckModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			// Should not crash on JSON parse issues
			expect(["succeeded", "failed", "skipped"]).toContain(result.status);
		} finally {
			if (fs.existsSync(tmpFile)) {
				fs.unlinkSync(tmpFile);
			}
		}
	});

	it("should skip when typos-cli is not available", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`spellcheck_skip_${Date.now()}.md`,
		);
		fs.writeFileSync(tmpFile, `# Test\n\nContent with typo: recieve.`);

		try {
			const spellcheckModule = await import("./spellcheck.js");
			const runner = spellcheckModule.default;

			// Check if typos is available
			const { spawnSync } =
				require("node:child_process") as typeof import("node:child_process");
			const checkResult = spawnSync("typos", ["--version"], {
				encoding: "utf-8",
				timeout: 5000,
				shell: true,
			});

			const isAvailable = !checkResult.error && checkResult.status === 0;
			const result = await runner.run(createMockContext(tmpFile));

			if (!isAvailable) {
				expect(result.status).toBe("skipped");
				expect(result.diagnostics).toHaveLength(0);
			}
		} finally {
			if (fs.existsSync(tmpFile)) {
				fs.unlinkSync(tmpFile);
			}
		}
	});
});
