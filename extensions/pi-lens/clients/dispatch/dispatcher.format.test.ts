import { describe, expect, it } from "vitest";
import { formatDiagnostic } from "./utils/format-utils.ts";

describe("formatDiagnostic with code fixes", () => {
	it("should format multi-line messages with proper indentation", () => {
		const diagnostic = {
			id: "ts-12-2345",
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

		// Should have proper indentation on both lines
		expect(formatted).toBe(
			"  L12: Property 'debug' is missing in type 'Config'\n  💡 Quick fix: Add missing property 'debug'",
		);
	});

	it("should format single-line messages", () => {
		const diagnostic = {
			id: "ts-5-1234",
			message: "Cannot find name 'foo'",
			filePath: "/test.ts",
			line: 5,
			severity: "error" as const,
			semantic: "blocking" as const,
			tool: "ts-lsp",
			rule: "TS1234",
		};

		const formatted = formatDiagnostic(diagnostic);

		expect(formatted).toBe("  L5: Cannot find name 'foo'");
	});

	it("should handle diagnostics without line numbers", () => {
		const diagnostic = {
			id: "test-1",
			message: "General error\n💡 Fix: Do something",
			filePath: "/test.ts",
			severity: "warning" as const,
			semantic: "warning" as const,
			tool: "test",
			rule: "test",
		};

		const formatted = formatDiagnostic(diagnostic);

		expect(formatted).toBe("  General error\n  💡 Fix: Do something");
	});
});
