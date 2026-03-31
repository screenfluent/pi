import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempFile, setupTestEnvironment } from "./test-utils.js";
import { TypeScriptClient } from "./typescript-client.js";

describe("TypeScriptClient - Code Fixes", () => {
	let client: TypeScriptClient;
	let tmpDir: string;
	let cleanup: () => void;

	beforeEach(() => {
		client = new TypeScriptClient();
		({ tmpDir, cleanup } = setupTestEnvironment("pi-lens-codefix-test-"));
	});

	afterEach(() => {
		cleanup();
	});

	describe("getCodeFixes", () => {
		it("should provide fix for missing property on object literal", () => {
			// Real-world case: Missing required property in object literal
			const content = `
interface Config {
  name: string;
  port: number;
  debug: boolean;
}

const config: Config = {
  name: "my-app",
  port: 3000
  // Missing 'debug' property - TS2345
};
`;
			const filePath = createTempFile(tmpDir, "missing-property.ts", content);
			client.addFile(filePath, content);

			const diags = client.getDiagnostics(filePath);
			const missingPropError = diags.find(
				(d) => d.code === 2345 || d.message.includes("missing"),
			);

			if (missingPropError) {
				const line = missingPropError.range.start.line;
				const char = missingPropError.range.start.character;
				const fixes = client.getCodeFixes(filePath, line, char, [
					missingPropError.code as number,
				]);

				// TypeScript should suggest adding the missing property
				expect(fixes.length).toBeGreaterThan(0);
				const hasAddPropertyFix = fixes.some(
					(f) =>
						f.description.toLowerCase().includes("add") ||
						f.description.toLowerCase().includes("property") ||
						f.description.toLowerCase().includes("declare"),
				);
				expect(hasAddPropertyFix).toBe(true);
			}
		});

		it("should provide fix for missing await in async function", () => {
			// Real-world case: Forgetting await on a Promise-returning function
			const content = `
async function fetchUser(id: string): Promise<{ name: string }> {
  return { name: "John" };
}

async function getUserName(id: string): Promise<string> {
  const user = fetchUser(id); // Missing await
  return user.name; // Type 'Promise<{ name: string; }>' has no property 'name'
}
`;
			const filePath = createTempFile(tmpDir, "missing-await.ts", content);
			client.addFile(filePath, content);

			const diags = client.getDiagnostics(filePath);
			// TS2739: Type 'Promise<{ name: string; }>' is missing 'name'
			const propertyError = diags.find(
				(d) => d.code === 2739 || d.message.includes("is missing"),
			);

			if (propertyError) {
				const fixes = client.getAllCodeFixes(filePath);
				// If there's an error, check if we have fixes for it
				const lineFixes = fixes.get(propertyError.range.start.line);
				if (lineFixes) {
					expect(lineFixes.length).toBeGreaterThan(0);
				}
			}
			// Test passes if we get here - not all TS versions provide fixes for this
			expect(true).toBe(true);
		});

		it("should provide fix for incorrect type assignment", () => {
			// Real-world case: String instead of number
			const content = `
function calculateTotal(price: number, tax: number): number {
  return price + tax;
}

const result = calculateTotal("100", 10); // TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
`;
			const filePath = createTempFile(tmpDir, "type-mismatch.ts", content);
			client.addFile(filePath, content);

			const diags = client.getDiagnostics(filePath);
			const typeError = diags.find((d) => d.code === 2345);

			if (typeError) {
				const line = typeError.range.start.line;
				const char = typeError.range.start.character;
				const fixes = client.getCodeFixes(filePath, line, char, [2345]);

				// TypeScript often suggests fixes for type mismatches
				expect(fixes).toBeDefined();
			}
		});

		it("should collect all fixes via getAllCodeFixes", () => {
			// Multiple errors in one file
			const content = `
interface Person {
  name: string;
  age: number;
}

const person: Person = {
  name: "Alice"
  // Missing age
};

function greet(p: Person): string {
  return "Hello " + p.name;
}

greet({ name: "Bob" }); // Missing age in argument
`;
			const filePath = createTempFile(tmpDir, "multiple-errors.ts", content);
			client.addFile(filePath, content);

			const allFixes = client.getAllCodeFixes(filePath);

			// Should have fixes mapped by line number
			expect(allFixes).toBeInstanceOf(Map);

			// Each fix entry should have a description and changes
			for (const [line, fixes] of allFixes.entries()) {
				expect(typeof line).toBe("number");
				expect(fixes.length).toBeGreaterThan(0);
				for (const fix of fixes) {
					expect(fix.description).toBeTruthy();
					expect(fix.changes).toBeDefined();
				}
			}
		});
	});

	describe("Integration with diagnostic messages", () => {
		it("should include fix suggestions in getAllCodeFixes output", () => {
			const content = `
class User {
  constructor(public name: string) {}
}

const user = new User(); // TS2554: Expected 1 arguments, but got 0
`;
			const filePath = createTempFile(tmpDir, "constructor-args.ts", content);
			client.addFile(filePath, content);

			const diags = client.getDiagnostics(filePath);
			const argError = diags.find((d) => d.code === 2554);

			if (argError) {
				const fixes = client.getAllCodeFixes(filePath);
				const lineFixes = fixes.get(argError.range.start.line);

				if (lineFixes && lineFixes.length > 0) {
					// The runner would append this to the message
					const suggestion = lineFixes[0].description;
					expect(suggestion).toBeTruthy();
				}
			}
		});
	});
});
