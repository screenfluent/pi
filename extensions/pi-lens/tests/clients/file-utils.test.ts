import { describe, expect, it } from "vitest";
import { isExcludedDirName } from "../../clients/file-utils.js";

describe("file-utils exclusion matching", () => {
	it("matches exact exclusions case-insensitively", () => {
		expect(isExcludedDirName("node_modules")).toBe(true);
		expect(isExcludedDirName("NODE_MODULES")).toBe(true);
		expect(isExcludedDirName("Coverage")).toBe(true);
	});

	it("matches glob exclusions like *.dSYM", () => {
		expect(isExcludedDirName("MyApp.dSYM")).toBe(true);
		expect(isExcludedDirName("myapp.DSYM")).toBe(true);
		expect(isExcludedDirName("dSYM")).toBe(false);
	});

	it("supports caller-provided extra exclusion patterns", () => {
		expect(isExcludedDirName("custom-out", ["custom-out"])).toBe(true);
		expect(isExcludedDirName("build-cache", ["build-*"])).toBe(true);
		expect(isExcludedDirName("custom-in", ["custom-out"])).toBe(false);
	});

	it("excludes common agent/tooling directories", () => {
		expect(isExcludedDirName(".claude")).toBe(true);
		expect(isExcludedDirName(".codex")).toBe(true);
		expect(isExcludedDirName(".worktrees")).toBe(true);
		expect(isExcludedDirName(".vscode")).toBe(true);
	});
});
