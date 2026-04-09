/**
 * LSP Server Definitions Test Suite
 * 
 * Tests for server definitions including:
 * - Root detection with various project markers
 * - Server matching by extension
 * - Custom server creation
 * - Server registry operations
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	LSP_SERVERS,
	TypeScriptServer,
	PythonServer,
	GoServer,
	RustServer,
	getServerForExtension,
	getServerById,
	getServersForFile,
	createRootDetector,
} from "../server.ts";
import * as fs from "fs/promises";

// Mock fs/promises - need to mock the module before it's imported
vi.mock("fs/promises", async () => {
	const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
	return {
		...actual,
		stat: vi.fn(),
		access: vi.fn(),
	};
});

describe("createRootDetector", () => {
	const mockStat = vi.mocked(fs.stat);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should return undefined when no markers exist", async () => {
		// Mock all stat calls to throw (file not found)
		mockStat.mockRejectedValue(new Error("ENOENT"));

		const detector = createRootDetector(["package.json"]);
		const root = await detector("/project/src/components/Button.tsx");

		expect(root).toBeUndefined();
	});

	it("should return undefined for empty marker list", async () => {
		const detector = createRootDetector([]);
		const root = await detector("/project/file.ts");

		expect(root).toBeUndefined();
	});

	it("should stop at filesystem root", async () => {
		mockStat.mockRejectedValue(new Error("ENOENT"));

		const detector = createRootDetector(["package.json"]);
		const root = await detector("C:/file.ts");

		// Should reach root and return undefined
		expect(root).toBeUndefined();
	});

	it("should respect exclude patterns", async () => {
		// First call finds node_modules (excluded)
		mockStat.mockImplementation(async (filepath: any) => {
			if (filepath.includes("node_modules")) {
				return { isDirectory: () => true } as any;
			}
			throw new Error("ENOENT");
		});

		const detector = createRootDetector(["package.json"], ["node_modules"]);
		const root = await detector("/project/node_modules/lib/index.ts");

		expect(root).toBeUndefined();
	});
});

describe("TypeScriptServer", () => {
	const mockStat = vi.mocked(fs.stat);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should have correct ID and name", () => {
		expect(TypeScriptServer.id).toBe("typescript");
		expect(TypeScriptServer.name).toBe("TypeScript Language Server");
	});

	it("should match TypeScript extensions", () => {
		expect(TypeScriptServer.extensions).toContain(".ts");
		expect(TypeScriptServer.extensions).toContain(".tsx");
		expect(TypeScriptServer.extensions).toContain(".ts");
		expect(TypeScriptServer.extensions).toContain(".jsx");
		expect(TypeScriptServer.extensions).toContain(".mts");
		expect(TypeScriptServer.extensions).toContain(".cts");
	});

	it("should return undefined when no project markers found", async () => {
		mockStat.mockRejectedValue(new Error("ENOENT"));

		const root = await TypeScriptServer.root("/project/src/index.ts");
		expect(root).toBeUndefined();
	});

	it("should have spawn function", () => {
		expect(typeof TypeScriptServer.spawn).toBe("function");
	});
});

describe("PythonServer", () => {
	const mockStat = vi.mocked(fs.stat);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should have correct ID and name", () => {
		expect(PythonServer.id).toBe("python");
		expect(PythonServer.name).toBe("Pyright Language Server");
	});

	it("should match Python extensions", () => {
		expect(PythonServer.extensions).toContain(".py");
		expect(PythonServer.extensions).toContain(".pyi");
	});

	it("should return undefined when no project markers found", async () => {
		mockStat.mockRejectedValue(new Error("ENOENT"));

		const root = await PythonServer.root("/project/src/main.py");
		expect(root).toBeUndefined();
	});

	it("should have spawn function", () => {
		expect(typeof PythonServer.spawn).toBe("function");
	});
});

describe("GoServer", () => {
	it("should have correct ID and name", () => {
		expect(GoServer.id).toBe("go");
		expect(GoServer.name).toBe("gopls");
	});

	it("should match .go extension", () => {
		expect(GoServer.extensions).toContain(".go");
	});

	it("should have root detection function", () => {
		expect(typeof GoServer.root).toBe("function");
	});

	it("should have spawn function", () => {
		expect(typeof GoServer.spawn).toBe("function");
	});
});

describe("RustServer", () => {
	it("should have correct ID and name", () => {
		expect(RustServer.id).toBe("rust");
		expect(RustServer.name).toBe("rust-analyzer");
	});

	it("should match .rs extension", () => {
		expect(RustServer.extensions).toContain(".rs");
	});

	it("should have root detection function", () => {
		expect(typeof RustServer.root).toBe("function");
	});

	it("should have spawn function", () => {
		expect(typeof RustServer.spawn).toBe("function");
	});
});

describe("getServerForExtension", () => {
	it("should return TypeScript server for .ts files", () => {
		const server = getServerForExtension(".ts");
		expect(server?.id).toBe("typescript");
	});

	it("should return Python server for .py files", () => {
		const server = getServerForExtension(".py");
		expect(server?.id).toBe("python");
	});

	it("should return Go server for .go files", () => {
		const server = getServerForExtension(".go");
		expect(server?.id).toBe("go");
	});

	it("should return Rust server for .rs files", () => {
		const server = getServerForExtension(".rs");
		expect(server?.id).toBe("rust");
	});

	it("should return undefined for unknown extensions", () => {
		const server = getServerForExtension(".unknown");
		expect(server).toBeUndefined();
	});
});

describe("getServerById", () => {
	it("should return server by ID", () => {
		const server = getServerById("typescript");
		expect(server?.name).toBe("TypeScript Language Server");
	});

	it("should return Python server by ID", () => {
		const server = getServerById("python");
		expect(server?.name).toBe("Pyright Language Server");
	});

	it("should return Go server by ID", () => {
		const server = getServerById("go");
		expect(server?.name).toBe("gopls");
	});

	it("should return Rust server by ID", () => {
		const server = getServerById("rust");
		expect(server?.name).toBe("rust-analyzer");
	});

	it("should return undefined for unknown ID", () => {
		const server = getServerById("unknown");
		expect(server).toBeUndefined();
	});
});

describe("getServersForFile", () => {
	it("should find servers for TypeScript file", () => {
		const servers = getServersForFile("/project/src/index.ts");
		expect(servers.some((s) => s.id === "typescript")).toBe(true);
	});

	it("should find servers for Python file", () => {
		const servers = getServersForFile("/project/src/main.py");
		expect(servers.some((s) => s.id === "python")).toBe(true);
	});

	it("should find servers for Go file", () => {
		const servers = getServersForFile("/project/cmd/app/main.go");
		expect(servers.some((s) => s.id === "go")).toBe(true);
	});

	it("should find servers for Rust file", () => {
		const servers = getServersForFile("/project/src/main.rs");
		expect(servers.some((s) => s.id === "rust")).toBe(true);
	});

	it("should return empty array for unknown file type", () => {
		const servers = getServersForFile("/project/file.unknown");
		expect(servers).toEqual([]);
	});

	it("should be case insensitive for extensions", () => {
		const servers1 = getServersForFile("/project/file.TS");
		const servers2 = getServersForFile("/project/file.ts");
		expect(servers1.map((s) => s.id)).toEqual(servers2.map((s) => s.id));
	});
});

describe("LSP_SERVERS registry", () => {
	it("should contain all expected servers", () => {
		const serverIds = LSP_SERVERS.map((s) => s.id);

		expect(serverIds).toContain("typescript");
		expect(serverIds).toContain("python");
		expect(serverIds).toContain("go");
		expect(serverIds).toContain("rust");
		expect(serverIds).toContain("ruby");
		expect(serverIds).toContain("php");
		expect(serverIds).toContain("java");
		expect(serverIds).toContain("cpp");
		expect(serverIds).toContain("bash");
		expect(serverIds).toContain("yaml");
		expect(serverIds).toContain("json");
		expect(serverIds).toContain("docker");
		expect(serverIds).toContain("vue");
		expect(serverIds).toContain("svelte");
	});

	it("should have unique server IDs", () => {
		const ids = LSP_SERVERS.map((s) => s.id);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});

	it("should have non-empty extensions for each server", () => {
		for (const server of LSP_SERVERS) {
			expect(server.extensions.length).toBeGreaterThan(0);
		}
	});

	it("should have valid extensions for each server", () => {
		for (const server of LSP_SERVERS) {
			// All extensions should start with . or be special names like "Dockerfile"
			const validExtensions = server.extensions.every(
				(ext) => ext.startsWith(".") || ext === "Dockerfile"
			);
			expect(validExtensions).toBe(true);
		}
	});

	it("should have spawn function for each server", () => {
		for (const server of LSP_SERVERS) {
			expect(typeof server.spawn).toBe("function");
		}
	});

	it("should have root detection function for each server", () => {
		for (const server of LSP_SERVERS) {
			expect(typeof server.root).toBe("function");
		}
	});

	it("should have name for each server", () => {
		for (const server of LSP_SERVERS) {
			expect(server.name).toBeTruthy();
			expect(typeof server.name).toBe("string");
		}
	});
});
