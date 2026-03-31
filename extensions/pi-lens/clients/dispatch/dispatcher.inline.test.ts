import { describe, expect, it } from "vitest";
import { formatDiagnostic } from "./utils/format-utils.js";

describe("formatDiagnostic inline output verification", () => {
	it("should display complete architect messages (NOT truncated to 'No ')", () => {
		// Simulate actual architect diagnostic
		const diagnostic = {
			id: "architect-1",
			message:
				"No absolute Windows paths — breaks CI and cross-platform builds.",
			filePath: "/test.ts",
			line: 5,
			severity: "warning" as const,
			semantic: "warning" as const,
			tool: "architect",
			rule: "no-absolute-windows-paths",
		};

		const output = formatDiagnostic(diagnostic);

		console.log("\n=== Architect Message Output ===");
		console.log(output);
		console.log("=================================\n");

		// Verify complete message is shown
		expect(output).toBe(
			"  L5: No absolute Windows paths — breaks CI and cross-platform builds.",
		);
	});

	it("should display code fix messages inline correctly", () => {
		// This is what I actually see from ts-lsp runner
		const diagnostic = {
			id: "ts-12-2345",
			message:
				"Property 'debug' is missing in type 'Config'\n💡 Quick fix: Add missing property 'debug'",
			filePath: "/src/config.ts",
			line: 12,
			severity: "error" as const,
			semantic: "blocking" as const,
			tool: "ts-lsp",
			rule: "TS2345",
			fixable: true,
			fixSuggestion: "Add missing property 'debug'",
		};

		const output = formatDiagnostic(diagnostic);

		console.log("\n=== Code Fix Message Output ===");
		console.log(output);
		console.log("================================\n");

		// Both lines should be properly indented
		expect(output).toBe(
			"  L12: Property 'debug' is missing in type 'Config'\n  💡 Quick fix: Add missing property 'debug'",
		);
	});

	it("should prove architect 'No ' messages are complete (not noise)", () => {
		// All the "No " messages from default-architect.yaml
		const testMessages = [
			"No absolute Windows paths — breaks CI and cross-platform builds.",
			"No hardcoded localhost URLs — use environment variables or a config service.",
			"No empty catch/except blocks. Swallowing errors makes debugging impossible — at least log the error.",
			"No hardcoded secrets — use environment variables or a secrets manager.",
			"No 'any' types — use 'unknown' or define a proper interface to maintain type safety.",
		];

		for (let i = 0; i < testMessages.length; i++) {
			const diagnostic = {
				id: `architect-${i}`,
				message: testMessages[i],
				filePath: "/test.ts",
				line: i + 1,
				severity: "warning" as const,
				semantic: "warning" as const,
				tool: "architect",
				rule: "test",
			};

			const output = formatDiagnostic(diagnostic);

			// Each message should be complete, NOT truncated to just "No "
			expect(output.length).toBeGreaterThan(15); // More than "  L1: No "
			expect(output).toContain("No ");
			expect(output).toContain("—"); // Contains the em-dash explanation

			// Verify it's not truncated
			const messageAfterNo = output.split("No ")[1];
			expect(messageAfterNo.length).toBeGreaterThan(5);
		}
	});
});
