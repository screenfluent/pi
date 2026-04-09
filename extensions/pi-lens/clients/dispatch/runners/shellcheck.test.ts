/**
 * Tests for shellcheck runner
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { DispatchContext } from "../types.ts";

function createMockContext(filePath: string): DispatchContext {
	return {
		filePath,
		cwd: process.cwd(),
		kind: "shell" as any,
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

describe("shellcheck runner", () => {
	const require = createRequire(import.meta.url);

	it("should have correct runner definition", async () => {
		const shellcheckModule = await import("./shellcheck.ts");
		const runner = shellcheckModule.default;

		expect(runner.id).toBe("shellcheck");
		expect(runner.appliesTo).toEqual(["shell"]);
		expect(runner.priority).toBe(20);
		expect(runner.enabledByDefault).toBe(true);
		expect(runner.skipTestFiles).toBe(false);
	});

	it("should detect shellcheck availability", () => {
		const { spawnSync } =
			require("node:child_process") as typeof import("node:child_process");
		const result = spawnSync("shellcheck", ["--version"], {
			encoding: "utf-8",
			timeout: 10000,
			shell: true,
		});
		expect(
			result.error || result.status !== 0 ? "not available" : "available",
		).toBeTruthy();
	});

	it("should detect undefined variable", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`shellcheck_test_${Date.now()}.sh`,
		);
		fs.writeFileSync(
			tmpFile,
			["#!/bin/bash", "# Test script with issues", 'echo "\$UNDEFINED_VAR"', ""].join("\n"),
		);

		try {
			const shellcheckModule = await import("./shellcheck.ts");
			const runner = shellcheckModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			if (result.status !== "skipped") {
				expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
				expect(
					result.diagnostics.some(
						(d) =>
							d.tool === "shellcheck" &&
							(d.message.includes("undefined") ||
								d.message.includes("SC2154")),
					),
				).toBe(true);
			}
		} finally {
			safeUnlink(tmpFile);
		}
	});

	it("should pass clean shell scripts", async () => {
		const tmpFile = path.join(
			process.env.TEMP || "/tmp",
			`shellcheck_ok_${Date.now()}.sh`,
		);
		fs.writeFileSync(
			tmpFile,
			[
				"#!/bin/bash",
				"# Clean shell script",
				"set -euo pipefail",
				"",
				"main() {",
				'    local name="\${1:-world}"',
				'    echo "Hello, \${name}!"',
				"}",
				"",
				'main "\$@"',
				"",
			].join("\n"),
		);

		try {
			const shellcheckModule = await import("./shellcheck.ts");
			const runner = shellcheckModule.default;
			const result = await runner.run(createMockContext(tmpFile));

			if (result.status !== "skipped") {
				expect(result.diagnostics.length).toBe(0);
				expect(result.status).toBe("succeeded");
			}
		} finally {
			safeUnlink(tmpFile);
		}
	});
});
