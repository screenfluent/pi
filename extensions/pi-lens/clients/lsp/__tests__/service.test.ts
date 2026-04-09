/**
 * LSP Service Test Suite
 * 
 * Tests for the LSP Service layer including:
 * - Client lifecycle management
 * - Effect-TS integration
 * - File operations (open/update/getDiagnostics)
 * - Server availability checking
 * - Cleanup and shutdown
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Effect } from "effect";
import { LSPService, lspEffect, getLSPService, resetLSPService } from "../index.ts";
import type { LSPClientInfo } from "../client.ts";
import type { LSPServerInfo } from "../server.ts";

// Mock the dependencies
vi.mock("../server.ts", async () => {
	const actual = await vi.importActual<typeof import("../server.ts")>("../server.ts");
	return {
		...actual,
		getServersForFileWithConfig: vi.fn(),
	};
});

vi.mock("../config.ts", () => ({
	initLSPConfig: vi.fn(),
	getServersForFileWithConfig: vi.fn(),
}));

vi.mock("../language.ts", () => ({
	getLanguageId: vi.fn(() => "typescript"),
}));

vi.mock("../launch.ts", () => ({
	launchLSP: vi.fn(),
}));

vi.mock("../client.ts", () => ({
	createLSPClient: vi.fn(),
}));

import { getServersForFileWithConfig as mockGetServersForFile } from "../config.ts";
import { createLSPClient as mockCreateLSPClient } from "../client.ts";

describe("LSPService", () => {
	let service: LSPService;

	beforeEach(() => {
		resetLSPService();
		service = getLSPService();
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await service.shutdown();
		resetLSPService();
	});

	describe("constructor", () => {
		it("should initialize with empty state", () => {
			const status = service.getStatus();
			expect(status).toEqual([]);
		});

		it("should create fresh LSPState", () => {
			// Verify service was created with initial state
			expect(service).toBeDefined();
			expect(service).toBeInstanceOf(LSPService);
		});
	});

	describe("hasLSP", () => {
		it("should return false when no servers match file extension", async () => {
			vi.mocked(mockGetServersForFile).mockReturnValue([]);
			
			const result = await service.hasLSP("/test/file.unknown");
			expect(result).toBe(false);
		});

		it("should return true when server matches and provides root", async () => {
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn(),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			
			const result = await service.hasLSP("/project/test.ts");
			expect(result).toBe(true);
		});

		it("should return false when server cannot determine root", async () => {
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue(undefined),
				spawn: vi.fn(),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			
			const result = await service.hasLSP("/project/test.ts");
			expect(result).toBe(false);
		});

		it("should check all matching servers until root is found", async () => {
			const server1: LSPServerInfo = {
				id: "server1",
				name: "Server 1",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue(undefined),
				spawn: vi.fn(),
			};
			const server2: LSPServerInfo = {
				id: "server2",
				name: "Server 2",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn(),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([server1, server2]);
			
			const result = await service.hasLSP("/project/test.ts");
			expect(result).toBe(true);
			expect(server1.root).toHaveBeenCalled();
			expect(server2.root).toHaveBeenCalled();
		});
	});

	describe("getClientForFile", () => {
		it("should return undefined when no servers match", async () => {
			vi.mocked(mockGetServersForFile).mockReturnValue([]);
			
			const result = await service.getClientForFile("/test/file.unknown");
			expect(result).toBeUndefined();
		});

		it("should cache and reuse existing client", async () => {
			const mockClient = createMockClient();
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn().mockResolvedValue({
					process: { pid: 123 } as any,
				}),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			vi.mocked(mockCreateLSPClient).mockResolvedValue(mockClient as any);
			
			// First call creates client
			const result1 = await service.getClientForFile("/project/test.ts");
			expect(result1).toBeDefined();
			expect(mockCreateLSPClient).toHaveBeenCalledTimes(1);
			
			// Second call returns cached client
			const result2 = await service.getClientForFile("/project/other.ts");
			expect(result2?.client).toBe(result1?.client);
			expect(mockCreateLSPClient).toHaveBeenCalledTimes(1); // Not called again
		});

		it("should handle server spawn failure", async () => {
			const mockSpawn = vi.fn().mockRejectedValue(new Error("Spawn failed"));
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: mockSpawn as any,
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			
			const result = await service.getClientForFile("/project/test.ts");
			expect(result).toBeUndefined();
		});

		it("should try next server when first fails", async () => {
			const mockClient = createMockClient();
			const failingServer: LSPServerInfo = {
				id: "server1",
				name: "Failing Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn().mockRejectedValue(new Error("Spawn failed")) as any,
			};
			const workingServer: LSPServerInfo = {
				id: "server2",
				name: "Working Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn().mockResolvedValue({
					process: { pid: 456 } as any,
				}),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([failingServer, workingServer]);
			vi.mocked(mockCreateLSPClient).mockResolvedValue(mockClient as any);
			
			const result = await service.getClientForFile("/project/test.ts");
			expect(result).toBeDefined();
			expect(result?.info.id).toBe("server2");
		});
	});

	describe("openFile", () => {
		it("should send didOpen notification with correct parameters", async () => {
			const mockClient = createMockClient();
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn().mockResolvedValue({
					process: { pid: 123 } as any,
				}),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			vi.mocked(mockCreateLSPClient).mockResolvedValue(mockClient as any);
			
			await service.openFile("/project/test.ts", "const x = 1;");
			
			expect(mockClient.notify.open).toHaveBeenCalledWith(
				"/project/test.ts",
				"const x = 1;",
				"typescript"
			);
		});

		it("should do nothing when no LSP available", async () => {
			vi.mocked(mockGetServersForFile).mockReturnValue([]);
			
			// Should not throw
			await expect(service.openFile("/test.unknown", "content"))
				.resolves.not.toThrow();
		});
	});

	describe("updateFile", () => {
		it("should send didChange notification", async () => {
			const mockClient = createMockClient();
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn().mockResolvedValue({
					process: { pid: 123 } as any,
				}),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			vi.mocked(mockCreateLSPClient).mockResolvedValue(mockClient as any);
			
			await service.updateFile("/project/test.ts", "const x = 2;");
			
			expect(mockClient.notify.change).toHaveBeenCalledWith(
				"/project/test.ts",
				"const x = 2;"
			);
		});
	});

	describe("getDiagnostics", () => {
		it("should return diagnostics from client", async () => {
			const mockDiagnostics = [
				{
					severity: 1 as const,
					message: "Type error",
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 5 },
					},
				},
			];
			const mockClient = createMockClient(mockDiagnostics);
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn().mockResolvedValue({
					process: { pid: 123 } as any,
				}),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			vi.mocked(mockCreateLSPClient).mockResolvedValue(mockClient as any);
			
			const result = await service.getDiagnostics("/project/test.ts");
			
			expect(result).toEqual(mockDiagnostics);
			expect(mockClient.waitForDiagnostics).toHaveBeenCalled();
		});

		it("should return empty array when no LSP available", async () => {
			vi.mocked(mockGetServersForFile).mockReturnValue([]);
			
			const result = await service.getDiagnostics("/test.unknown");
			expect(result).toEqual([]);
		});
	});

	describe("shutdown", () => {
		it("should shutdown all clients", async () => {
			const mockClient1 = createMockClient();
			const mockClient2 = createMockClient();
			
			// Add clients to service
			const mockServer1: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project1"),
				spawn: vi.fn().mockResolvedValue({ process: { pid: 1 } as any }),
			};
			const mockServer2: LSPServerInfo = {
				id: "python",
				name: "Python Server",
				extensions: [".py"],
				root: vi.fn().mockResolvedValue("/project2"),
				spawn: vi.fn().mockResolvedValue({ process: { pid: 2 } as any }),
			};
			
			vi.mocked(mockGetServersForFile)
				.mockReturnValueOnce([mockServer1])
				.mockReturnValueOnce([mockServer2]);
			
			vi.mocked(mockCreateLSPClient)
				.mockResolvedValueOnce(mockClient1)
				.mockResolvedValueOnce(mockClient2);
			
			// Create clients
			await service.getClientForFile("/project1/test.ts");
			await service.getClientForFile("/project2/test.py");
			
			await service.shutdown();
			
			expect(mockClient1.shutdown).toHaveBeenCalled();
			expect(mockClient2.shutdown).toHaveBeenCalled();
		});

		it("should handle shutdown errors gracefully", async () => {
			const mockClient = createMockClient();
			(mockClient.shutdown as any).mockRejectedValue(new Error("Shutdown failed"));
			
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn().mockResolvedValue({ process: { pid: 123 } as any }),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			vi.mocked(mockCreateLSPClient).mockResolvedValue(mockClient as any);
			
			await service.getClientForFile("/project/test.ts");
			
			// Should not throw even when client shutdown fails
			await expect(service.shutdown()).resolves.not.toThrow();
		});
	});

	describe("getStatus", () => {
		it("should return status of all active clients", async () => {
			const mockClient = createMockClient();
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn().mockResolvedValue({ process: { pid: 123 } as any }),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			vi.mocked(mockCreateLSPClient).mockResolvedValue(mockClient as any);
			
			await service.getClientForFile("/project/test.ts");
			
			const status = service.getStatus();
			expect(status).toHaveLength(1);
			expect(status[0]).toEqual({
				serverId: "typescript",
				root: "/project",
				connected: true,
			});
		});
	});
});

describe("lspEffect", () => {
	let service: LSPService;
	let effect: ReturnType<typeof lspEffect>;

	beforeEach(() => {
		resetLSPService();
		service = getLSPService();
		effect = lspEffect(service);
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await service.shutdown();
		resetLSPService();
	});

	describe("openFile Effect", () => {
		it("should wrap openFile in Effect", async () => {
			const mockClient = createMockClient();
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn().mockResolvedValue({ process: { pid: 123 } as any }),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			vi.mocked(mockCreateLSPClient).mockResolvedValue(mockClient as any);
			
			const program = effect.openFile("/project/test.ts", "content");
			const result = await Effect.runPromise(program);
			
			expect(result).toBeUndefined();
			expect(mockClient.notify.open).toHaveBeenCalled();
		});

		it("should handle errors in Effect", async () => {
			vi.mocked(mockGetServersForFile).mockReturnValue([]);
			
			const program = effect.openFile("/test.unknown", "content");
			// Should complete successfully (no-op for unknown files)
			await expect(Effect.runPromise(program)).resolves.not.toThrow();
		});
	});

	describe("getDiagnostics Effect", () => {
		it("should wrap getDiagnostics in Effect", async () => {
			const mockDiagnostics = [{ severity: 1, message: "Error", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }];
			const mockClient = createMockClient(mockDiagnostics);
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn().mockResolvedValue({ process: { pid: 123 } as any }),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			vi.mocked(mockCreateLSPClient).mockResolvedValue(mockClient as any);
			
			const program = effect.getDiagnostics("/project/test.ts");
			const result = await Effect.runPromise(program);
			
			expect(result).toEqual(mockDiagnostics);
		});
	});

	describe("hasLSP Effect", () => {
		it("should wrap hasLSP in Effect", async () => {
			const mockServer: LSPServerInfo = {
				id: "typescript",
				name: "TypeScript Server",
				extensions: [".ts"],
				root: vi.fn().mockResolvedValue("/project"),
				spawn: vi.fn(),
			};
			vi.mocked(mockGetServersForFile).mockReturnValue([mockServer]);
			
			const program = effect.hasLSP("/project/test.ts");
			const result = await Effect.runPromise(program);
			
			expect(result).toBe(true);
		});
	});

	describe("shutdown Effect", () => {
		it("should wrap shutdown in Effect", async () => {
			const program = effect.shutdown();
			const result = await Effect.runPromise(program);
			
			expect(result).toBeUndefined();
		});
	});
});

// Helper function to create mock client
function createMockClient(diagnostics: any[] = []): LSPClientInfo {
	return {
		serverId: "test-server",
		root: "/test",
		connection: {} as any,
		notify: {
			open: vi.fn().mockResolvedValue(undefined),
			change: vi.fn().mockResolvedValue(undefined),
		},
		getDiagnostics: vi.fn().mockReturnValue(diagnostics),
		waitForDiagnostics: vi.fn().mockResolvedValue(undefined),
		shutdown: vi.fn().mockResolvedValue(undefined),
	};
}
