import { describe, expect, it } from "vitest";
import { formatDiagnostic } from "./utils/format-utils.js";

describe("formatDiagnostic edge cases", () => {
	it("should handle messages with colons correctly", () => {
		// This tests the actual format of inline code fix messages
		const diagnostic = {
			id: "architect-1",
			// This is the format of architect warnings - starts with "No "
			message:
				"No absolute Windows paths — breaks CI and cross-platform builds.",
			filePath: "/test.ts",
			line: 10,
			severity: "warning" as const,
			semantic: "warning" as const,
			tool: "architect",
			rule: "no-absolute-paths",
		};

		const formatted = formatDiagnostic(diagnostic);

		// Should show the complete message, not cut off at "No "
		expect(formatted).toContain("No absolute Windows paths");
		expect(formatted).toContain("breaks CI and cross-platform builds");
		expect(formatted).not.toBe("  L10: No "); // Should NOT be truncated
	});

	it("should handle code fix messages with newlines", () => {
		const diagnostic = {
			id: "ts-12-2345",
			// This is the actual format from ts-lsp runner
			message:
				"Property 'debug' is missing in type 'Config'\n💡 Quick fix: Add missing property 'debug'",
			filePath: "/test.ts",
			line: 12,
			severity: "error" as const,
			semantic: "blocking" as const,
			tool: "ts-lsp",
			rule: "TS2345",
		};

		const formatted = formatDiagnostic(diagnostic);

		// Should have both lines properly indented
		expect(formatted).toBe(
			"  L12: Property 'debug' is missing in type 'Config'\n  💡 Quick fix: Add missing property 'debug'",
		);
	});

	it("should handle messages with em-dashes (—)", () => {
		const diagnostic = {
			id: "architect-2",
			message:
				"No hardcoded secrets — use environment variables or a secrets manager.",
			filePath: "/test.ts",
			line: 5,
			severity: "warning" as const,
			semantic: "warning" as const,
			tool: "architect",
			rule: "no-secrets",
		};

		const formatted = formatDiagnostic(diagnostic);

		// Should preserve the full message with em-dash
		expect(formatted).toContain("No hardcoded secrets");
		expect(formatted).toContain("use environment variables");
	});

	it("should not truncate architect 'No ' messages", () => {
		// Testing all the "No " patterns from default-architect.yaml
		const testMessages = [
			"No absolute Windows paths — breaks CI and cross-platform builds.",
			"No hardcoded localhost URLs — use environment variables or a config service.",
			"No empty catch/except blocks. Swallowing errors makes debugging impossible — at least log the error.",
			"No hardcoded secrets — use environment variables or a secrets manager.",
			"No 'any' types — use 'unknown' or define a proper interface to maintain type safety.",
		];

		for (const message of testMessages) {
			const diagnostic = {
				id: "test-1",
				message,
				filePath: "/test.ts",
				line: 1,
				severity: "warning" as const,
				semantic: "warning" as const,
				tool: "architect",
				rule: "test",
			};

			const formatted = formatDiagnostic(diagnostic);

			// Each formatted message should be more than just "  L1: No "
			expect(formatted.length).toBeGreaterThan(10);
			expect(formatted).toContain("No ");
			expect(formatted).toContain("—"); // Should have the em-dash
		}
	});
});
