import { describe, expect, it } from "vitest";
import {
	canRunStartupHeavyScans,
	getLspCapableKinds,
	getPrimaryDispatchGroup,
	getStartupDefaultsForProfile,
} from "../../clients/language-policy.ts";

describe("language-policy", () => {
	it("exposes LSP-capable kinds from centralized policy", () => {
		const kinds = getLspCapableKinds();
		expect(kinds).toContain("python");
		expect(kinds).toContain("yaml");
		expect(kinds).not.toContain("sql");
	});

	it("gates config-sensitive startup defaults while keeping core defaults", () => {
		const profile = {
			present: {
				jsts: true,
				python: true,
				go: false,
				rust: false,
				cxx: false,
				cmake: false,
				shell: false,
				json: false,
				markdown: false,
				css: false,
				yaml: true,
				sql: true,
				ruby: false,
			},
			configured: {
				jsts: false,
				python: false,
				yaml: true,
				sql: false,
			},
			counts: {},
			detectedKinds: ["jsts", "python", "yaml", "sql"],
		} as const;

		const tools = getStartupDefaultsForProfile(profile);
		expect(tools).toContain("pyright");
		expect(tools).toContain("ruff");
		expect(tools).not.toContain("typescript-language-server");
		expect(tools).toContain("yamllint");
		expect(tools).not.toContain("sqlfluff");
	});

	it("uses centralized heavy-scan gate policy", () => {
		const profile = {
			present: {
				jsts: true,
				python: false,
				go: false,
				rust: false,
				cxx: false,
				cmake: false,
				shell: false,
				json: false,
				markdown: false,
				css: false,
				yaml: false,
				sql: false,
				ruby: false,
			},
			configured: { jsts: false },
			counts: {},
			detectedKinds: ["jsts"],
		} as const;

		expect(canRunStartupHeavyScans(profile, "jsts")).toBe(false);
		const configured = { ...profile, configured: { jsts: true } };
		expect(canRunStartupHeavyScans(configured, "jsts")).toBe(true);
	});

	it("provides language primary dispatch fallback groups", () => {
		const py = getPrimaryDispatchGroup("python", true);
		expect(py?.runnerIds).toEqual(["lsp", "pyright"]);

		const pyNoLsp = getPrimaryDispatchGroup("python", false);
		expect(pyNoLsp?.runnerIds).toEqual(["pyright"]);

		const sql = getPrimaryDispatchGroup("sql", true);
		expect(sql?.runnerIds).toEqual(["sqlfluff"]);
	});
});
