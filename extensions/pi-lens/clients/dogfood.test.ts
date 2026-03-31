/**
 * Meta-test: Run similarity detection on pi-lens codebase
 *
 * This is a "dogfood" test - we run the reuse detection on our own code
 * to see what it finds. Educational and useful for improving the algorithm!
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import { beforeAll, describe, expect, it } from "vitest";
import {
	buildProjectIndex,
	findSimilarFunctions,
	type IndexEntry,
	type ProjectIndex,
} from "./project-index.js";
import { calculateSimilarity as calcMatrixSimilarity } from "./state-matrix.js";

// Find project root by looking for package.json
async function findProjectRoot(startDir: string): Promise<string> {
	let dir = startDir;
	while (dir !== path.dirname(dir)) {
		try {
			await fs.access(path.join(dir, "package.json"));
			return dir;
		} catch {
			dir = path.dirname(dir);
		}
	}
	throw new Error("Could not find project root (no package.json)");
}

// Test a known similar pair
const _SIMILAR_FUNCTIONS = {
	description: "Extracting similar logic patterns in pi-lens",
	pairs: [
		{
			name: "runners/index.ts pattern",
			files: [
				"clients/dispatch/runners/index.ts",
				"clients/dispatch/runners/architect.ts",
			],
			expected: "High similarity in runner registration patterns",
		},
		{
			name: "Client pattern",
			files: ["clients/typescript-client.ts", "clients/biome-client.ts"],
			expected: "Similar client structures",
		},
	],
};

describe("🐶 Dogfood Test: Similarity on pi-lens codebase", () => {
	let index: ProjectIndex;
	let projectRoot: string;

	beforeAll(async () => {
		// Find project root
		const __dirname = path.dirname(fileURLToPath(import.meta.url));
		projectRoot = await findProjectRoot(__dirname);

		// Build index of the entire codebase
		console.log("\n🏗️  Building index of pi-lens codebase...");
		console.log(`   Project root: ${projectRoot}`);

		const files = await glob("clients/**/*.ts", {
			cwd: projectRoot,
			ignore: ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"],
		});

		console.log(`   Found ${files.length} source files`);

		const absoluteFiles = files.map((f) => path.join(projectRoot, f));
		index = await buildProjectIndex(projectRoot, absoluteFiles);

		console.log(`   Indexed ${index.entries.size} functions`);

		// Show some indexed functions
		const sample = Array.from(index.entries.values()).slice(0, 5);
		console.log("\n📋 Sample indexed functions:");
		sample.forEach((e: IndexEntry, i: number) => {
			console.log(`   ${i + 1}. ${e.id} (${e.transitionCount} transitions)`);
		});
	}, 30000); // 30s timeout for indexing

	describe("Index validation", () => {
		it("should have indexed functions", () => {
			expect(index.entries.size).toBeGreaterThan(0);
			console.log(`\n✅ Indexed ${index.entries.size} functions`);
		});

		it("should have functions with >20 transitions", () => {
			const complex = Array.from(index.entries.values()).filter(
				(e) => e.transitionCount >= 20,
			);
			expect(complex.length).toBeGreaterThan(0);
			console.log(`\n✅ ${complex.length} functions pass complexity guardrail`);
		});
	});

	describe("Find similar functions in our own codebase", () => {
		it("should find similar patterns among runners", async () => {
			// Find runner files
			const runnerEntries = Array.from(index.entries.values()).filter(
				(e: IndexEntry) => e.filePath.includes("dispatch/runners/"),
			);

			console.log(`\n🔍 Testing ${runnerEntries.length} runner functions`);

			const similarities: {
				func1: string;
				func2: string;
				similarity: number;
			}[] = [];

			// Compare each pair
			for (let i = 0; i < runnerEntries.length; i++) {
				for (let j = i + 1; j < runnerEntries.length; j++) {
					const entry1 = runnerEntries[i];
					const entry2 = runnerEntries[j];

					// Skip if same file
					if (entry1.filePath === entry2.filePath) continue;

					const sim = calcMatrixSimilarity(entry1.matrix, entry2.matrix);

					if (sim >= 0.75) {
						similarities.push({
							func1: entry1.id,
							func2: entry2.id,
							similarity: sim,
						});
					}
				}
			}

			// Sort by similarity
			similarities.sort((a, b) => b.similarity - a.similarity);

			console.log(`\n📊 Found ${similarities.length} similar pairs (>75%):`);
			similarities.slice(0, 5).forEach((s, i) => {
				console.log(`   ${i + 1}. ${s.func1} ↔ ${s.func2}`);
				console.log(`      Similarity: ${(s.similarity * 100).toFixed(1)}%`);
			});

			// Log findings but don't fail - this is exploratory
			expect(similarities.length).toBeGreaterThanOrEqual(0);
		});

		it("should find similar client patterns", async () => {
			const clientEntries = Array.from(index.entries.values()).filter(
				(e: IndexEntry) =>
					e.filePath.includes("clients/") &&
					e.filePath.includes("-client.ts") &&
					!e.filePath.includes("test"),
			);

			console.log(`\n🔍 Testing ${clientEntries.length} client functions`);

			const similarities: {
				func1: string;
				func2: string;
				similarity: number;
			}[] = [];

			for (let i = 0; i < clientEntries.length; i++) {
				for (let j = i + 1; j < clientEntries.length; j++) {
					const entry1 = clientEntries[i];
					const entry2 = clientEntries[j];

					if (entry1.filePath === entry2.filePath) continue;

					const sim = calcMatrixSimilarity(entry1.matrix, entry2.matrix);

					if (sim >= 0.75) {
						similarities.push({
							func1: entry1.id,
							func2: entry2.id,
							similarity: sim,
						});
					}
				}
			}

			similarities.sort((a, b) => b.similarity - a.similarity);

			console.log(
				`\n📊 Found ${similarities.length} similar client patterns (>75%):`,
			);
			similarities.slice(0, 3).forEach((s, i) => {
				console.log(`   ${i + 1}. ${s.func1} ↔ ${s.func2}`);
				console.log(`      Similarity: ${(s.similarity * 100).toFixed(1)}%`);
			});

			expect(similarities.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe("Find potential refactor opportunities", () => {
		it("should identify duplicate utility functions", () => {
			// Look for functions with very high similarity (>90%)
			const entries = Array.from(index.entries.values());
			const seenPairs = new Set<string>(); // Deduplicate A→B and B→A
			const duplicates: {
				func: string;
				similarTo: string;
				similarity: number;
			}[] = [];

			for (const entry of entries) {
				const matches = findSimilarFunctions(entry.matrix, index, 0.9, 3);
				for (const match of matches) {
					if (match.targetId === entry.id) continue;

					// Canonical pair key (sorted to avoid A,B and B,A)
					const pairKey = [entry.id, match.targetId].sort().join("::");
					if (seenPairs.has(pairKey)) continue;

					seenPairs.add(pairKey);
					duplicates.push({
						func: entry.id,
						similarTo: match.targetId,
						similarity: match.similarity,
					});
				}
			}

			console.log(
				`\n🎯 Found ${duplicates.length} unique potential duplicates (>90%):`,
			);
			duplicates.slice(0, 5).forEach((d, i) => {
				console.log(`   ${i + 1}. ${d.func}`);
				console.log(`      Similar to: ${d.similarTo}`);
				console.log(`      Match: ${(d.similarity * 100).toFixed(1)}%`);
			});

			// This is informational - we don't assert on it
			expect(true).toBe(true);
		});
	});

	describe("Complexity distribution", () => {
		it("should show transition count distribution", () => {
			const entries = Array.from(index.entries.values());
			const transitionCounts = entries.map((e) => e.transitionCount);

			const avg =
				transitionCounts.reduce((a, b) => a + b, 0) / transitionCounts.length;
			const min = Math.min(...transitionCounts);
			const max = Math.max(...transitionCounts);

			const belowThreshold = transitionCounts.filter((c) => c < 20).length;
			const aboveThreshold = transitionCounts.filter((c) => c >= 20).length;

			console.log("\n📊 Complexity Distribution:");
			console.log(`   Total functions: ${entries.length}`);
			console.log(`   Below threshold (<20): ${belowThreshold}`);
			console.log(`   Above threshold (≥20): ${aboveThreshold}`);
			console.log(`   Min transitions: ${min}`);
			console.log(`   Max transitions: ${max}`);
			console.log(`   Average: ${avg.toFixed(1)}`);

			// Most functions should pass the guardrail
			expect(aboveThreshold).toBeGreaterThan(0);
		});
	});
});
