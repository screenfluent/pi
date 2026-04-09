import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAvailabilityChecker } from "../../../../clients/dispatch/runners/utils/runner-helpers.ts";
import { setupTestEnvironment } from "../../test-utils.ts";

vi.mock("../../../../clients/safe-spawn.ts", () => ({
	safeSpawn: vi.fn(() => ({ stdout: "", stderr: "", status: 1 })),
}));

describe("runner-helpers availability checker", () => {
	beforeEach(async () => {
		const safeSpawnMod = await import("../../../../clients/safe-spawn.ts");
		vi.mocked(safeSpawnMod.safeSpawn).mockReset();
	});

	it("caches availability per cwd (does not leak false across projects)", async () => {
		const safeSpawnMod = await import("../../../../clients/safe-spawn.ts");
		const dirA = setupTestEnvironment("pi-lens-a-");
		const dirB = setupTestEnvironment("pi-lens-b-");
		try {
			const ruffBUnix = path.join(dirB.tmpDir, ".venv", "bin", "ruff");
			const ruffBWin = path.join(dirB.tmpDir, ".venv", "Scripts", "ruff.exe");
			fs.mkdirSync(path.dirname(ruffBUnix), { recursive: true });
			fs.mkdirSync(path.dirname(ruffBWin), { recursive: true });
			fs.writeFileSync(ruffBUnix, "#!/bin/sh\nexit 0\n");
			fs.writeFileSync(ruffBWin, "@echo off\n");

			const checker = createAvailabilityChecker("ruff", ".exe");

			vi.mocked(safeSpawnMod.safeSpawn).mockImplementation((cmd) => {
				const text = String(cmd);
				if (text.includes(dirB.tmpDir)) {
					return { stdout: "ruff 1.0.0", stderr: "", status: 0 };
				}
				return { stdout: "", stderr: "not found", status: 1 };
			});

			expect(checker.isAvailable(dirA.tmpDir)).toBe(false);
			expect(checker.isAvailable(dirB.tmpDir)).toBe(true);
			expect(checker.getCommand(dirA.tmpDir)).toBeNull();
			expect(checker.getCommand(dirB.tmpDir)).toContain(dirB.tmpDir);
		} finally {
			dirA.cleanup();
			dirB.cleanup();
		}
	});
});
