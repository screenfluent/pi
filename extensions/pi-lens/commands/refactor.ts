import * as nodeFs from "node:fs";
import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { ArchitectClient } from "../clients/architect-client.js";
import type { AstGrepClient } from "../clients/ast-grep-client.js";
import { createAutoLoop } from "../clients/auto-loop.js";
import type { ComplexityClient } from "../clients/complexity-client.js";
import {
	scanArchitectViolations,
	scanComplexityMetrics,
	scanSkipViolations,
	scoreFiles,
} from "../clients/scan-architectural-debt.js";

// Auto-loop singleton for refactor command (initialized at module load)
let refactorLoop: ReturnType<typeof createAutoLoop> | null = null;

export function initRefactorLoop(pi: ExtensionAPI) {
	if (!refactorLoop) {
		refactorLoop = createAutoLoop(pi, {
			name: "refactor",
			maxIterations: 5,
			command: "/lens-booboo-refactor --loop",
			exitPatterns: [
				/✅ No architectural debt found/,
				/No more files to refactor/,
			],
			completionPatterns: [/✅ No architectural debt found/],
			continuePrompt:
				"Continue to next worst offender with /lens-booboo-refactor --loop",
		});
		// refactor auto-loop initialized silently
	}
	return refactorLoop;
}

function getRefactorLoop(pi: ExtensionAPI) {
	if (!refactorLoop) {
		return initRefactorLoop(pi);
	}
	return refactorLoop;
}

export async function handleRefactor(
	args: string,
	ctx: ExtensionContext,
	clients: {
		astGrep: AstGrepClient;
		complexity: ComplexityClient;
		architect: ArchitectClient;
	},
	pi: ExtensionAPI,
	skipRules: Set<string>,
	ruleActions: Record<string, { note: string }>,
) {
	const loopMode = args.includes("--loop");
	const cleanArgs = args.replace("--loop", "").trim();
	const targetPath = cleanArgs || ctx.cwd || process.cwd();

	// Initialize auto-loop if --loop flag
	const loop = getRefactorLoop(pi);
	if (loopMode && !loop.getState().active) {
		loop.start(ctx);
	}

	ctx.ui.notify("🏗️ Scanning for architectural debt...", "info");

	const configPath = path.join(
		process.cwd(),
		"rules",
		"ast-grep-rules",
		".sgconfig.yml",
	);
	const isTsProject = nodeFs.existsSync(path.join(targetPath, "tsconfig.json"));

	const skipByFile = scanSkipViolations(
		clients.astGrep,
		configPath,
		targetPath,
		isTsProject,
		skipRules,
		ruleActions,
	);
	const metricsByFile = scanComplexityMetrics(
		clients.complexity,
		targetPath,
		isTsProject,
	);
	const architectViolations = clients.architect.hasConfig()
		? scanArchitectViolations(clients.architect, targetPath)
		: new Map<string, string[]>();
	const scored = scoreFiles(skipByFile, metricsByFile, architectViolations);

	if (scored.length === 0) {
		ctx.ui.notify(
			"✅ No architectural debt found — codebase is clean.",
			"info",
		);
		return;
	}

	// --- Write ranked list to TSV for agent reference ---
	const reportDir = path.join(process.cwd(), ".pi-lens", "reports");
	nodeFs.mkdirSync(reportDir, { recursive: true });
	const reportPath = path.join(reportDir, "refactor-ranked.tsv");

	const tsvRows: string[] = [
		"rank\tfile\tscore\tmi\tcognitive\tnesting\tviolations",
	];
	scored.slice(0, 50).forEach((f, i) => {
		const m = metricsByFile.get(f.file);
		const skipCount = skipByFile.get(f.file)?.length ?? 0;
		const archCount = architectViolations?.get(f.file)?.length ?? 0;
		const totalViolations = skipCount + archCount;
		const relPath = path.relative(targetPath, f.file).replace(/\\/g, "/");
		tsvRows.push(
			`${i + 1}\t${relPath}\t${f.score}\t${m?.mi.toFixed(1) ?? "-"}\t${m?.cognitive ?? "-"}\t${m?.nesting ?? "-"}\t${totalViolations}`,
		);
	});
	nodeFs.writeFileSync(reportPath, tsvRows.join("\n"), "utf-8");

	// --- Current worst offender ---
	const { file: worstFile, score } = scored[0];
	const relFile = path.relative(targetPath, worstFile).replace(/\\/g, "/");
	const issues = skipByFile.get(worstFile) ?? [];
	const metrics = metricsByFile.get(worstFile);
	const archIssues = architectViolations.get(worstFile) ?? [];

	const ruleGroups = new Map<string, number>();
	for (const i of issues)
		ruleGroups.set(i.rule, (ruleGroups.get(i.rule) ?? 0) + 1);

	const issuesSummary = [...ruleGroups.entries()]
		.map(
			([r, n]) =>
				`- \`${r}\` (×${n})${ruleActions[r] ? ` — ${ruleActions[r].note}` : ""}`,
		)
		.join("\n");
	const archSummary =
		archIssues.length > 0 ? archIssues.map((m) => `- ${m}`).join("\n") : "None";
	const metricsSummary = metrics
		? `MI: ${metrics.mi.toFixed(1)}, Cognitive: ${metrics.cognitive}, Nesting: ${metrics.nesting}`
		: "";

	// First violation line for quick reference
	const firstViolationLine = issues.length > 0 ? issues[0].line : null;

	// --- Full ranked list in terminal (agent won't read TSV) ---
	const topFiles = scored
		.slice(0, 15)
		.map((f, i) => {
			const name = path.relative(targetPath, f.file).replace(/\\/g, "/");
			const m = metricsByFile.get(f.file);
			const mi = m ? `MI:${m.mi.toFixed(0)}` : "";
			return `  ${i + 1}. ${name} (${f.score} pts${mi ? `, ${mi}` : ""})`;
		})
		.join("\n");

	ctx.ui.notify(
		`🏗️ Worst: ${relFile} (score: ${score}) — ${scored.length} files with debt`,
		"info",
	);
	console.log(
		`\n📊 Ranked by debt score:\n${topFiles}${scored.length > 15 ? `\n  ... and ${scored.length - 15} more` : ""}\n`,
	);

	// --- Steer message for agent ---
	const steer = [
		`🏗️ BOOBOO REFACTOR — worst offender identified`,
		"",
		`**File**: \`${relFile}\` (debt score: ${score})`,
		"",
		metrics ? `**Complexity**: ${metricsSummary}` : "",
		"",
		issues.length > 0 ? `**Violations**:\n${issuesSummary}` : "",
		archIssues.length > 0
			? `**Architectural rules violated**:\n${archSummary}`
			: "",
		firstViolationLine ? `First violation at line ${firstViolationLine}` : "",
		"",
		`📄 Read \`${relFile}\` when ready to implement`,
		"",
		"**Your job**:",
		"1. Analyze this code — what's the most impactful refactoring for this file?",
		"2. Build 3-5 refactoring options. For each, explain *why* it helps and *what* you'd change. Mark one as recommended.",
		"3. For each option, estimate the impact: linesReduced (number), miProjection (e.g. '3.5 → 8'), cognitiveProjection (e.g. '1533 → 1400').",
		"4. Include an option to skip to the next worst offender.",
		"5. Call the `interviewer` tool with:",
		"   - `question`: what you're asking the user",
		"   - `options`: array of { value, label, context, recommended, impact: { linesReduced, miProjection, cognitiveProjection } }",
		"6. The user picks an option or types a free-text response in the browser form.",
		"7. Implement the refactoring. After changes, run `git diff HEAD~1` to capture what was changed.",
		"8. Run a complexity scan on the changed file(s) to compute the metrics delta (before vs after MI, cognitive).",
		"9. Call the `interviewer` tool AGAIN with confirmationMode=true. The plan should contain: what was changed (summary + diff lines), how metrics evolved, and a free-chat option for refinements.",
		"10. If the user describes changes: make further edits, re-run the scan, call interviewer again with an updated report. Repeat until satisfied.",
		"11. CRITICAL: Once the user is satisfied with the current file, you MUST re-scan the project (or re-run /lens-booboo-refactor) and immediately start the process for the NEXT worst offender. Do not stop until all architectural debt is resolved.",
	].join("\n");

	pi.sendUserMessage(steer, { deliverAs: "steer" });
}
