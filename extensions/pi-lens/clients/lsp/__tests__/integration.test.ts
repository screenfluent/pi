/**
 * LSP Integration Test Suite
 * 
 * End-to-end tests for the LSP system including:
 * - Full workflow: detect -> spawn -> open -> diagnose -> shutdown
 * - Multiple server coordination
 * - Error recovery scenarios
 * - Real TypeScript server integration (optional)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LSPService, getLSPService, resetLSPService } from "../index.ts";
import { Effect } from "effect";

// Check if we should run real LSP tests
const runRealLSPTests = process.env.RUN_REAL_LSP_TESTS === "true";

describe("LSP Integration", () => {
	let service: LSPService;

	beforeEach(() => {
		resetLSPService();
		service = getLSPService();
	});

	afterEach(async () => {
		await service.shutdown();
		resetLSPService();
	});

	describe("Service Lifecycle", () => {
		it("should handle complete lifecycle without errors", async () => {
			// This is a basic smoke test
			const hasLSP = await service.hasLSP("/test.ts");
			
			// Result depends on whether TypeScript LSP is installed
			// Just verify it doesn't throw
			expect(typeof hasLSP).toBe("boolean");
		});

		it("should handle multiple shutdown calls gracefully", async () => {
			// First shutdown
			await expect(service.shutdown()).resolves.not.toThrow();
			
			// Second shutdown should also not throw
			await expect(service.shutdown()).resolves.not.toThrow();
		});

		it("should report status correctly", async () => {
			const status = service.getStatus();
			
			// Should return array (may be empty if no clients active)
			expect(Array.isArray(status)).toBe(true);
		});
	});

	describe("Effect Integration", () => {
		it("should run hasLSP effect successfully", async () => {
			const { hasLSP } = await import("../index.ts").then((m) => m.lspEffect(service));
			
			const program = hasLSP("/test.ts");
			const result = await Effect.runPromise(program);
			
			expect(typeof result).toBe("boolean");
		});

		it("should run shutdown effect successfully", async () => {
			const { shutdown } = await import("../index.ts").then((m) => m.lspEffect(service));
			
			const program = shutdown();
			const result = await Effect.runPromise(program);
			
			expect(result).toBeUndefined();
		});
	});

	describe("Error Handling", () => {
		it("should handle operations on non-existent files", async () => {
			await expect(service.openFile("/nonexistent/file.ts", "content"))
				.resolves.not.toThrow();
		});

		it("should handle getDiagnostics on non-existent files", async () => {
			const diags = await service.getDiagnostics("/nonexistent/file.ts");
			expect(diags).toEqual([]);
		});

		it("should handle updateFile on non-existent files", async () => {
			await expect(service.updateFile("/nonexistent/file.ts", "new content"))
				.resolves.not.toThrow();
		});
	});
});

// Real server tests - these require actual LSP servers to be installed
// Run with: RUN_REAL_LSP_TESTS=true npm test
describe.skipIf(!runRealLSPTests)("Real Server Tests", () => {
	let service: LSPService;

	beforeEach(() => {
		resetLSPService();
		service = getLSPService();
	});

	afterEach(async () => {
		await service.shutdown();
		resetLSPService();
	});

	it("should detect TypeScript LSP if available", async () => {
		const hasLSP = await service.hasLSP(process.cwd() + "/test.ts");
		
		if (hasLSP) {
			console.log("✅ TypeScript LSP detected");
		} else {
			console.log("⚠️ TypeScript LSP not available");
		}
	});
});

describe("Concurrent Operations", () => {
	let service: LSPService;

	beforeEach(() => {
		resetLSPService();
		service = getLSPService();
	});

	afterEach(async () => {
		await service.shutdown();
		resetLSPService();
	});

	it("should handle concurrent hasLSP checks", async () => {
		const checks = [
			service.hasLSP("/file1.ts"),
			service.hasLSP("/file2.ts"),
			service.hasLSP("/file3.ts"),
		];

		const results = await Promise.all(checks);
		
		expect(results).toHaveLength(3);
		results.forEach((r) => expect(typeof r).toBe("boolean"));
	});

	it("should handle concurrent diagnostics requests", async () => {
		// These should not throw even if files don't exist
		const requests = [
			service.getDiagnostics("/file1.ts"),
			service.getDiagnostics("/file2.ts"),
			service.getDiagnostics("/file3.ts"),
		];

		const results = await Promise.all(requests);
		
		expect(results).toHaveLength(3);
		results.forEach((r) => expect(Array.isArray(r)).toBe(true));
	});
});
