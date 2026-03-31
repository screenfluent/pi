import { describe, expect, it } from "vitest";
import { formatRateResult } from "./rate.js";

// Test the formatting functions directly with mock data

describe("formatRateResult", () => {
	it("should format a visual score breakdown", () => {
		const result = {
			overall: 75,
			categories: [
				{ name: "Type Safety", score: 85, icon: "🔷", issues: [] },
				{ name: "Complexity", score: 70, icon: "🧩", issues: [] },
				{ name: "Security", score: 100, icon: "🔒", issues: [] },
				{ name: "Architecture", score: 85, icon: "🏗️", issues: [] },
				{ name: "Dead Code", score: 100, icon: "🗑️", issues: [] },
				{ name: "Tests", score: 100, icon: "✅", issues: [] },
			],
		};

		const output = formatRateResult(result);

		expect(output).toContain("CODE QUALITY SCORE");
		expect(output).toContain("75/100");
		expect(output).toContain("Type Safety");
		expect(output).toContain("Security");
		expect(output).toContain("Tests");
	});

	it("should show correct grade for A", () => {
		const result = {
			overall: 95,
			categories: Array(6).fill({
				name: "Test",
				score: 95,
				icon: "✅",
				issues: [],
			}),
		};
		const output = formatRateResult(result);
		expect(output).toContain("A");
	});

	it("should show correct grade for B", () => {
		const result = {
			overall: 85,
			categories: Array(6).fill({
				name: "Test",
				score: 85,
				icon: "✅",
				issues: [],
			}),
		};
		const output = formatRateResult(result);
		expect(output).toContain("B");
	});

	it("should show correct grade for C", () => {
		const result = {
			overall: 75,
			categories: Array(6).fill({
				name: "Test",
				score: 75,
				icon: "✅",
				issues: [],
			}),
		};
		const output = formatRateResult(result);
		expect(output).toContain("C");
	});

	it("should show issues section when there are problems", () => {
		const result = {
			overall: 50,
			categories: [
				{
					name: "Type Safety",
					score: 50,
					icon: "🔷",
					issues: ["50 untyped identifiers"],
				},
				{
					name: "Complexity",
					score: 50,
					icon: "🧩",
					issues: ["High complexity: foo.ts"],
				},
				{ name: "Security", score: 100, icon: "🔒", issues: [] },
				{ name: "Architecture", score: 100, icon: "🏗️", issues: [] },
				{ name: "Dead Code", score: 100, icon: "🗑️", issues: [] },
				{ name: "Tests", score: 100, icon: "✅", issues: [] },
			],
		};
		const output = formatRateResult(result);
		expect(output).toContain("Issues to address");
		expect(output).toContain("Type Safety");
		expect(output).toContain("/lens-booboo");
	});

	it("should not show issues section when clean", () => {
		const result = {
			overall: 100,
			categories: Array(6).fill({
				name: "Test",
				score: 100,
				icon: "✅",
				issues: [],
			}),
		};
		const output = formatRateResult(result);
		expect(output).not.toContain("Issues to address");
	});

	it("should use colored bars based on score", () => {
		const resultHigh = {
			overall: 90,
			categories: [{ name: "Test", score: 85, icon: "✅", issues: [] }],
		};
		const resultLow = {
			overall: 50,
			categories: [{ name: "Test", score: 50, icon: "✅", issues: [] }],
		};

		const outputHigh = formatRateResult(resultHigh);
		const outputLow = formatRateResult(resultLow);

		// High score should have green squares
		expect(outputHigh).toContain("🟩");
		// Low score should have red squares
		expect(outputLow).toContain("🟥");
	});
});
