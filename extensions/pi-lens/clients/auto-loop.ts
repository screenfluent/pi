/**
 * Auto-loop engine for pi-lens fix and refactor commands.
 *
 * Provides automatic iteration without requiring the user to manually
 * re-run the command each time. Uses pi's event system (agent_end)
 * to trigger the next iteration automatically.
 *
 * IMPORTANT: Must be initialized at extension load time (in index.ts),
 * not lazily when the command is called. Event handlers need to be
 * registered early to catch agent_end events.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";

export interface LoopConfig {
	/** Unique identifier for this loop instance (e.g., "fix", "refactor") */
	name: string;
	/** Maximum iterations before stopping */
	maxIterations: number;
	/** Command to run for each iteration (e.g., "/lens-booboo-fix --loop") */
	command: string;
	/** Patterns that indicate the loop should exit (e.g., "no more fixable issues") */
	exitPatterns: RegExp[];
	/** Patterns that indicate completion with success */
	completionPatterns?: RegExp[];
	/** Additional text to include when prompting for next iteration */
	continuePrompt?: string;
}

export interface LoopState {
	active: boolean;
	iteration: number;
	maxIterations: number;
}

export function createAutoLoop(
	pi: ExtensionAPI,
	config: LoopConfig,
): {
	start: (ctx: ExtensionContext) => void;
	stop: (ctx: ExtensionContext, reason: string) => void;
	getState: () => LoopState;
	setMaxIterations: (n: number) => void;
} {
	let state: LoopState = {
		active: false,
		iteration: 0,
		maxIterations: config.maxIterations,
	};

	const updateStatus = (ctx: ExtensionContext) => {
		if (state.active) {
			ctx.ui.setStatus(
				`loop-${config.name}`,
				`${config.name} (${state.iteration + 1}/${state.maxIterations})`,
			);
		} else {
			ctx.ui.setStatus(`loop-${config.name}`, undefined);
		}
	};

	const stop = (ctx: ExtensionContext, reason: string) => {
		const wasActive = state.active;
		state = {
			active: false,
			iteration: 0,
			maxIterations: config.maxIterations,
		};
		updateStatus(ctx);
		if (wasActive) {
			ctx.ui.notify(`✅ ${config.name} loop ${reason}`, "info");
		}
	};

	const complete = (ctx: ExtensionContext, reason: string) => {
		stop(ctx, reason);
	};

	const start = (ctx: ExtensionContext) => {
		if (state.active) {
			ctx.ui.notify(`${config.name} loop is already running`, "warning");
			return;
		}

		state = {
			active: true,
			iteration: 0,
			maxIterations: config.maxIterations,
		};

		updateStatus(ctx);
		ctx.ui.notify(
			`🔄 Starting ${config.name} auto-loop (max ${state.maxIterations} iterations)...`,
			"info",
		);
	};

	const getState = (): LoopState => ({ ...state });

	// --- Event Handlers (registered at module load time) ---

	// Handle user interruption (any manual input stops the loop)
	pi.on("input", async (event, ctx) => {
		if (!ctx.hasUI) return { action: "continue" as const };
		if (!state.active) return { action: "continue" as const };

		// User typed something manually → stop the auto-loop
		if (event.source === "interactive") {
			stop(ctx, "stopped (user interrupted)");
		}

		return { action: "continue" as const };
	});

	// Handle end of agent turn → check if we should continue
	pi.on("agent_end", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (!state.active) return;

		const assistantMessages = event.messages.filter(
			(m) => m.role === "assistant",
		);
		const lastAssistantMessage =
			assistantMessages[assistantMessages.length - 1];

		if (!lastAssistantMessage) {
			stop(ctx, "stopped (no response)");
			return;
		}

		const textContent = lastAssistantMessage.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		if (!textContent.trim()) {
			stop(ctx, "stopped (empty response)");
			return;
		}

		// Check for completion patterns (explicit success)
		if (config.completionPatterns) {
			const hasCompletion = config.completionPatterns.some((p) =>
				p.test(textContent),
			);
			if (hasCompletion) {
				complete(ctx, "completed successfully");
				return;
			}
		}

		// Check for exit patterns (could be success or stopped)
		const hasExit = config.exitPatterns.some((p) => p.test(textContent));
		if (hasExit) {
			complete(ctx, "completed - no more work");
			return;
		}

		// Check if agent is waiting for manual fixes (indicated in the prompt)
		// If the last message says "When done, run..." we should NOT auto-continue
		const awaitingManualFix = textContent.includes("When done, run");
		if (awaitingManualFix) {
			console.error("[auto-loop] Paused - awaiting agent manual fixes");
			updateStatus(ctx);
			// Don't send followUp - wait for agent to manually continue
			return;
		}

		// Check max iterations
		state.iteration++;
		if (state.iteration >= state.maxIterations) {
			stop(ctx, `stopped (max iterations ${state.maxIterations} reached)`);
			return;
		}

		// Continue to next iteration - send command as follow-up
		updateStatus(ctx);
		const continueMsg =
			config.continuePrompt || `Run ${config.command} to continue.`;
		console.error(
			`[auto-loop] Triggering iteration ${state.iteration + 1}/${state.maxIterations}: ${config.command}`,
		);
		pi.sendUserMessage(
			`🔄 Auto-loop (${state.iteration + 1}/${state.maxIterations}): ${continueMsg}`,
			{ deliverAs: "followUp" },
		);
	});

	return {
		start,
		stop,
		getState,
		setMaxIterations: (n: number) => {
			state.maxIterations = n;
		},
	};
}
