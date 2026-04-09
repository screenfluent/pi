/**
 * LSP Configuration Test Suite
 * 
 * Tests for configuration including:
 * - Config file loading
 * - Custom server creation
 * - Server registry management
 * - Disabled server handling
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";

// Mock fs/promises before importing the module under test
vi.mock("fs/promises", async () => {
	return {
		readFile: vi.fn(),
		access: vi.fn(),
		stat: vi.fn(),
	};
});

// Import after mocking
const { loadLSPConfig, createCustomServer, initLSPConfig, getAllServers, isServerDisabled, getServersForFileWithConfig } = await import("../config.ts");

const mockReadFile = vi.mocked(fs.readFile);

describe("loadLSPConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should load config from .pi-lens/lsp.json", async () => {
		const config = {
			servers: {
				"my-server": {
					name: "My Custom Server",
					extensions: [".myext"],
					command: "my-lsp",
					args: ["--stdio"],
				},
			},
		};

		mockReadFile.mockResolvedValue(JSON.stringify(config));

		const result = await loadLSPConfig("/project");

		expect(result).toEqual(config);
		expect(mockReadFile).toHaveBeenCalled();
	});

	it("should return empty config when file not found", async () => {
		mockReadFile.mockRejectedValue(new Error("ENOENT"));

		const result = await loadLSPConfig("/project");

		expect(result).toEqual({});
	});

	it("should handle invalid JSON gracefully", async () => {
		mockReadFile.mockResolvedValue("not valid json");

		const result = await loadLSPConfig("/project");

		expect(result).toEqual({});
	});

	it("should try multiple config paths", async () => {
		mockReadFile
			.mockRejectedValueOnce(new Error("ENOENT"))
			.mockRejectedValueOnce(new Error("ENOENT"))
			.mockResolvedValueOnce(JSON.stringify({ servers: {} }));

		const result = await loadLSPConfig("/project");

		expect(mockReadFile).toHaveBeenCalledTimes(3);
		expect(result).toEqual({ servers: {} });
	});
});

describe("createCustomServer", () => {
	it("should create server from config", () => {
		const config = {
			name: "Custom LSP",
			extensions: [".custom"],
			command: "custom-lsp",
			args: ["--stdio", "--verbose"],
			rootMarkers: [".customrc"],
		};

		const server = createCustomServer(config, "custom-server");

		expect(server.id).toBe("custom-server");
		expect(server.name).toBe("Custom LSP");
		expect(server.extensions).toEqual([".custom"]);
		expect(typeof server.spawn).toBe("function");
		expect(typeof server.root).toBe("function");
	});

	it("should use process.cwd() as root when no markers specified", async () => {
		const config = {
			name: "Simple LSP",
			extensions: [".simple"],
			command: "simple-lsp",
		};

		const server = createCustomServer(config, "simple");
		const root = await server.root("/any/path/file.simple");

		expect(root).toBe(process.cwd());
	});
});

describe("initLSPConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset by calling init with empty config
		mockReadFile.mockRejectedValue(new Error("ENOENT"));
		return initLSPConfig("/test-reset");
	});

	it("should initialize with empty config", async () => {
		mockReadFile.mockRejectedValue(new Error("ENOENT"));
		
		await initLSPConfig("/project");

		const servers = getAllServers();
		// Should have built-in servers
		expect(servers.some((s) => s.id === "typescript")).toBe(true);
	});

	it("should register custom servers from config", async () => {
		const config = {
			servers: {
				"custom-test-server": {
					name: "Custom Test Server",
					extensions: [".ctest"],
					command: "ctest-lsp",
				},
			},
		};

		mockReadFile.mockResolvedValue(JSON.stringify(config));
		await initLSPConfig("/project");

		const servers = getAllServers();
		expect(servers.some((s) => s.id === "custom-test-server")).toBe(true);
	});

	it("should handle disabled servers", async () => {
		const config = {
			disabledServers: ["python"],
		};

		mockReadFile.mockResolvedValue(JSON.stringify(config));
		await initLSPConfig("/project");

		expect(isServerDisabled("python")).toBe(true);
		expect(isServerDisabled("typescript")).toBe(false);
	});
});

describe("getAllServers", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mockReadFile.mockRejectedValue(new Error("ENOENT"));
		await initLSPConfig("/test");
	});

	it("should include built-in servers", () => {
		const servers = getAllServers();

		expect(servers.some((s) => s.id === "typescript")).toBe(true);
		expect(servers.some((s) => s.id === "python")).toBe(true);
		expect(servers.some((s) => s.id === "go")).toBe(true);
		expect(servers.some((s) => s.id === "rust")).toBe(true);
	});
});

describe("getServersForFileWithConfig", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mockReadFile.mockRejectedValue(new Error("ENOENT"));
		await initLSPConfig("/test");
	});

	it("should find TypeScript server for .ts files", () => {
		const servers = getServersForFileWithConfig("/project/file.ts");
		expect(servers.some((s) => s.id === "typescript")).toBe(true);
	});

	it("should find Python server for .py files", () => {
		const servers = getServersForFileWithConfig("/project/file.py");
		expect(servers.some((s) => s.id === "python")).toBe(true);
	});

	it("should return empty array for unknown file type", () => {
		const servers = getServersForFileWithConfig("/project/file.unknown");
		expect(servers).toEqual([]);
	});

	it("should be case insensitive for extensions", () => {
		const servers1 = getServersForFileWithConfig("/project/file.TS");
		const servers2 = getServersForFileWithConfig("/project/file.ts");
		expect(servers1.map((s) => s.id)).toEqual(servers2.map((s) => s.id));
	});
});
