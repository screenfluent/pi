// Integration test for the pi-lens-core Rust binary
// Run with: node rust/test_integration.mjs

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..").replace(/\\/g, "/");
const BIN = path
	.join(__dirname, "target", "debug", "pi-lens-core.exe")
	.replace(/\\/g, "/");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
	if (condition) {
		console.log(`  ✅ ${msg}`);
		passed++;
	} else {
		console.error(`  ❌ ${msg}`);
		failed++;
	}
}

function runBinary(request) {
	return new Promise((resolve, reject) => {
		const proc = spawn(BIN, [], { stdio: ["pipe", "pipe", "pipe"] });
		const chunks = [];
		const errChunks = [];
		proc.stdout.on("data", (d) => chunks.push(d));
		proc.stderr.on("data", (d) => errChunks.push(d));
		proc.on("close", (code) => {
			const stderr = Buffer.concat(errChunks).toString().trim();
			if (code !== 0) {
				return reject(new Error(`exit ${code}: ${stderr}`));
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString()));
			} catch (e) {
				reject(
					new Error(
						`JSON parse failed: ${e.message}\nstdout: ${Buffer.concat(chunks).toString().slice(0, 200)}`,
					),
				);
			}
		});
		proc.on("error", reject);
		proc.stdin.write(JSON.stringify(request));
		proc.stdin.end();
	});
}

// ─────────────────────────────────────────────────────────
// Test 1: Scan
// ─────────────────────────────────────────────────────────
console.log("\n📂  Test 1: File scanner");
{
	const t0 = Date.now();
	const resp = await runBinary({
		command: { scan: { extensions: [".ts"] } },
		project_root: ROOT,
	});
	const ms = Date.now() - t0;

	assert(resp.success === true, "scan returns success=true");
	assert(Array.isArray(resp.data.files), "data.files is an array");
	assert(
		resp.data.files.length > 50,
		`found >50 .ts files (got ${resp.data.files.length})`,
	);
	assert(
		resp.data.files.every((f) => f.path && f.size >= 0 && f.modified > 0),
		"every file has path, size, modified",
	);
	assert(
		!resp.data.files.some((f) => f.path.includes("node_modules")),
		"node_modules excluded (gitignore respected)",
	);
	// Files should be sorted
	const paths = resp.data.files.map((f) => f.path);
	assert(
		JSON.stringify(paths) === JSON.stringify([...paths].sort()),
		"results are sorted",
	);
	console.log(`  ⏱  ${ms}ms for ${resp.data.files.length} files`);

	// Stash file list for later tests
	globalThis.allFiles = resp.data.files.map((f) =>
		f.path.replace(/\\/g, "/").replace(ROOT + "/", ""),
	);
}

// ─────────────────────────────────────────────────────────
// Test 2: Build index
// ─────────────────────────────────────────────────────────
console.log("\n🏗   Test 2: Index builder");
{
	const subset = [
		"clients/state-matrix.ts",
		"clients/project-index.ts",
		"clients/native-rust-client.ts",
		"clients/dispatch/runners/similarity.ts",
	];

	const t0 = Date.now();
	const resp = await runBinary({
		command: { build_index: { files: subset } },
		project_root: ROOT,
	});
	const ms = Date.now() - t0;

	assert(resp.success === true, "build_index returns success=true");
	assert(
		typeof resp.data.index?.entry_count === "number",
		"index has entry_count",
	);
	assert(
		resp.data.index.entry_count > 10,
		`indexed >10 functions (got ${resp.data.index.entry_count})`,
	);
	assert(Array.isArray(resp.data.index.functions), "index.functions is array");

	const names = resp.data.index.functions.map((f) => f.name);
	assert(names.includes("buildStateMatrix"), "found buildStateMatrix");
	assert(names.includes("calculateSimilarity"), "found calculateSimilarity");

	const fns = resp.data.index.functions;
	assert(
		fns.every((f) => f.id && f.file_path && f.name && f.line > 0),
		"all functions have required fields",
	);
	console.log(
		`  ⏱  ${ms}ms to index ${resp.data.index.entry_count} functions from ${subset.length} files`,
	);
	console.log(`  📋 Functions: ${names.slice(0, 6).join(", ")}…`);
}

// ─────────────────────────────────────────────────────────
// Test 3: Disk persistence – index survives separate invocation
// ─────────────────────────────────────────────────────────
console.log("\n💾  Test 3: Disk persistence (separate process invocation)");
{
	// The previous build_index call should have written .pi-lens/rust-index.json.
	// A fresh similarity call (new process) should read it back.
	const resp = await runBinary({
		command: {
			similarity: { file_path: "clients/state-matrix.ts", threshold: 0.9 },
		},
		project_root: ROOT,
	});

	assert(resp.success === true, "similarity returns success=true");
	assert(Array.isArray(resp.data.similarities), "data.similarities is array");
	assert(
		resp.data.similarities.length > 0,
		`found >0 similarity matches (got ${resp.data.similarities.length})`,
	);

	// Each match should have source_id, target_id, similarity in [0,1]
	assert(
		resp.data.similarities.every(
			(m) =>
				m.source_id && m.target_id && m.similarity >= 0 && m.similarity <= 1,
		),
		"all matches have valid fields",
	);

	// Similarities should be sorted descending
	const sims = resp.data.similarities.map((m) => m.similarity);
	assert(
		sims.every((s, i) => i === 0 || s <= sims[i - 1]),
		"similarities sorted descending",
	);

	// Source functions should all be from state-matrix.ts
	assert(
		resp.data.similarities.every((m) =>
			m.source_id.startsWith("clients/state-matrix.ts"),
		),
		"source_id is from requested file",
	);

	console.log(`  📊 Top matches:`);
	resp.data.similarities.slice(0, 5).forEach((m) => {
		const src = m.source_id.split("::")[1];
		const tgt = m.target_id.split("::")[1];
		console.log(`     ${src} → ${tgt}  ${(m.similarity * 100).toFixed(1)}%`);
	});
}

// ─────────────────────────────────────────────────────────
// Test 4: Similarity – all functions in file covered
// ─────────────────────────────────────────────────────────
console.log("\n🔍  Test 4: Similarity covers all functions in file");
{
	const resp = await runBinary({
		command: {
			similarity: { file_path: "clients/state-matrix.ts", threshold: 0.0 },
		},
		project_root: ROOT,
	});

	const sourceIds = new Set(
		resp.data.similarities.map(
			(m) => m.source_id.split("::")[1]?.split("@")[0],
		),
	);
	console.log(`  Functions with matches: ${[...sourceIds].join(", ")}`);

	// Multiple distinct source functions should appear (not just the first one)
	assert(
		sourceIds.size > 1,
		`multiple source functions covered (got ${sourceIds.size})`,
	);
}

// ─────────────────────────────────────────────────────────
// Test 5: Tree-sitter query – TypeScript
// ─────────────────────────────────────────────────────────
console.log("\n🌳  Test 5: Tree-sitter query (TypeScript)");
{
	const resp = await runBinary({
		command: {
			query: {
				language: "typescript",
				query:
					"(export_statement (function_declaration name: (identifier) @fn))",
				file_path: ROOT + "/clients/state-matrix.ts",
			},
		},
		project_root: ROOT,
	});

	assert(resp.success === true, "query returns success=true");
	assert(Array.isArray(resp.data.query_results), "data.query_results is array");
	assert(
		resp.data.query_results.length > 5,
		`found >5 exported functions (got ${resp.data.query_results.length})`,
	);

	const names = resp.data.query_results.map((r) => r.text);
	assert(names.includes("buildStateMatrix"), "captured buildStateMatrix");
	assert(names.includes("calculateSimilarity"), "captured calculateSimilarity");
	assert(
		resp.data.query_results.every((r) => r.line > 0 && r.column > 0),
		"all captures have line/column",
	);
	console.log(`  Found: ${names.join(", ")}`);
}

// ─────────────────────────────────────────────────────────
// Test 6: Tree-sitter query – Rust
// ─────────────────────────────────────────────────────────
console.log("\n🦀  Test 6: Tree-sitter query (Rust)");
{
	const resp = await runBinary({
		command: {
			query: {
				language: "rust",
				query: "(function_item name: (identifier) @fn)",
				file_path: ROOT + "/rust/src/index.rs",
			},
		},
		project_root: ROOT,
	});

	assert(resp.success === true, "Rust query returns success=true");
	const names = resp.data.query_results?.map((r) => r.text) ?? [];
	assert(names.includes("build_project_index"), "found build_project_index");
	assert(names.includes("find_similar_to"), "found find_similar_to");
	assert(names.includes("extract_functions"), "found extract_functions");
	console.log(
		`  Found ${names.length} functions: ${names.slice(0, 5).join(", ")}…`,
	);
}

// ─────────────────────────────────────────────────────────
// Test 7: Error handling – bad language
// ─────────────────────────────────────────────────────────
console.log("\n🚨  Test 7: Error handling");
{
	const resp = await runBinary({
		command: {
			query: {
				language: "cobol",
				query: "(anything)",
				file_path: ROOT + "/clients/state-matrix.ts",
			},
		},
		project_root: ROOT,
	});

	assert(resp.success === false, "unsupported language returns success=false");
	assert(
		typeof resp.error === "string" && resp.error.length > 0,
		"error message present",
	);
	console.log(`  Error: ${resp.error}`);
}

// ─────────────────────────────────────────────────────────
// Test 8: Scan with .rs extension
// ─────────────────────────────────────────────────────────
console.log("\n📂  Test 8: Scan Rust source files");
{
	const resp = await runBinary({
		command: { scan: { extensions: [".rs"] } },
		project_root: ROOT + "/rust",
	});

	assert(resp.success === true, "scan .rs returns success=true");
	assert(
		resp.data.files.length >= 5,
		`found ≥5 .rs files (got ${resp.data.files.length})`,
	);
	const names = resp.data.files.map((f) => f.path.split(/[\\/]/).pop());
	assert(names.includes("lib.rs"), "found lib.rs");
	assert(names.includes("index.rs"), "found index.rs");
	assert(
		!resp.data.files.some((f) => f.path.includes("target")),
		"target/ excluded",
	);
	console.log(`  .rs files: ${names.join(", ")}`);
}

// ─────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
