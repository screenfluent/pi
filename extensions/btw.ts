import {
	buildSessionContext,
	codingTools,
	createAgentSession,
	createExtensionRuntime,
	getMarkdownTheme,
	SessionManager,
	type AgentSession,
	type AgentSessionEvent,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { type AssistantMessage, type Message, type ThinkingLevel as AiThinkingLevel } from "@mariozechner/pi-ai";
import {
	Container,
	Input,
	Markdown,
	truncateToWidth,
	visibleWidth,
	type Focusable,
	type KeybindingsManager,
	type OverlayHandle,
	type TUI,
} from "@mariozechner/pi-tui";

// ── Constants ────────────────────────────────────────────────────────

const BTW_SLOT_ENTRY = "btw-slot-entry";
const BTW_SLOT_ARCHIVE = "btw-slot-archive";
const BTW_LEGACY_ENTRY = "btw-thread-entry";
const BTW_LEGACY_RESET = "btw-thread-reset";
const LEGACY_SLOT_ID = "slot-legacy";

const BTW_SYSTEM_PROMPT = [
	"You are BTW, a side-channel assistant embedded in the user's coding agent.",
	"You have access to the main conversation context — use it to give informed answers.",
	"Help with focused questions, planning, and quick explorations.",
	"Be direct and practical.",
].join(" ");

const BTW_SUMMARY_PROMPT =
	"Summarize this side conversation for handoff into the main conversation. Keep key decisions, findings, risks, and next actions. Output only the summary.";

// ── Types ────────────────────────────────────────────────────────────

type SessionThinkingLevel = "off" | AiThinkingLevel;

type BtwDetails = {
	question: string;
	answer: string;
	timestamp: number;
	provider: string;
	model: string;
	thinkingLevel: SessionThinkingLevel;
	usage?: AssistantMessage["usage"];
};

type PersistedBtwEntry = BtwDetails & { slotId: string };
type PersistedBtwArchive = { slotId: string; timestamp: number };

type ToolCallInfo = {
	toolCallId: string;
	toolName: string;
	args: string;
	status: "running" | "done" | "error";
};

type BtwPendingState = {
	question: string | null;
	answer: string;
	error: string | null;
	toolCalls: Map<string, ToolCallInfo>;
	statusText: string;
};

type SideSessionRuntime = {
	session: AgentSession;
	unsubscribe: () => void;
};

type BtwSlotState = {
	id: string;
	title: string;
	thread: BtwDetails[];
	draft: string;
	busy: boolean;
	pending: BtwPendingState;
	runtime: SideSessionRuntime | null;
	createdAt: number;
	updatedAt: number;
};

type BtwStore = {
	slots: Map<string, BtwSlotState>;
	order: string[];
	activeSlotId: string | null;
};

type QueueItem = {
	slotId: string;
	question: string;
	ctx: ExtensionContext;
};

type OverlayRuntime = {
	handle?: OverlayHandle;
	refresh?: () => void;
	close?: () => void;
	finish?: () => void;
	setDraft?: (value: string) => void;
	getDraft?: () => string;
	closed?: boolean;
};

// ── Utility functions ────────────────────────────────────────────────

function stripDynamicSystemPromptFooter(sp: string): string {
	return sp
		.replace(/\nCurrent date and time:[^\n]*(?:\nCurrent working directory:[^\n]*)?$/u, "")
		.replace(/\nCurrent working directory:[^\n]*$/u, "")
		.trim();
}

function createBtwResourceLoader(ctx: ExtensionContext, append: string[] = [BTW_SYSTEM_PROMPT]): ResourceLoader {
	const ext = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	const sp = stripDynamicSystemPromptFooter(ctx.getSystemPrompt());
	return {
		getExtensions: () => ext,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => sp,
		getAppendSystemPrompt: () => append,
		getPathMetadata: () => new Map(),
		extendResources: () => {},
		reload: async () => {},
	};
}

function extractText(parts: AssistantMessage["content"]): string {
	return parts
		.filter((p) => p.type === "text")
		.map((p) => p.text)
		.join("\n")
		.trim();
}

function extractEventAssistantText(msg: unknown): string {
	if (!msg || typeof msg !== "object") return "";
	const m = msg as { role?: unknown; content?: unknown };
	if (m.role !== "assistant" || !Array.isArray(m.content)) return "";
	return m.content
		.filter(
			(p): p is { type: "text"; text: string } =>
				!!p && typeof p === "object" && (p as any).type === "text",
		)
		.map((p) => p.text)
		.join("\n")
		.trim();
}

function getLastAssistant(session: AgentSession): AssistantMessage | null {
	for (let i = session.state.messages.length - 1; i >= 0; i--) {
		if (session.state.messages[i].role === "assistant")
			return session.state.messages[i] as AssistantMessage;
	}
	return null;
}

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function buildSeedMessages(ctx: ExtensionContext, thread: BtwDetails[]): Message[] {
	const seed: Message[] = [];
	try {
		seed.push(
			...buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId())
				.messages,
		);
	} catch {
		/* ignore context seed failures */
	}
	for (const item of thread) {
		seed.push(
			{ role: "user", content: [{ type: "text", text: item.question }], timestamp: item.timestamp },
			{
				role: "assistant",
				content: [{ type: "text", text: item.answer }],
				provider: item.provider,
				model: item.model,
				api: ctx.model?.api ?? "openai-responses",
				usage: item.usage ?? EMPTY_USAGE,
				stopReason: "stop",
				timestamp: item.timestamp,
			},
		);
	}
	return seed;
}

function formatThread(thread: BtwDetails[]): string {
	return thread
		.map((d) => `User: ${d.question.trim()}\nAssistant: ${d.answer.trim()}`)
		.join("\n\n---\n\n");
}

function notify(
	ctx: ExtensionContext | ExtensionCommandContext,
	msg: string,
	level: "info" | "warning" | "error",
): void {
	if (ctx.hasUI) ctx.ui.notify(msg, level);
}

function fmtToolArgs(toolName: string, args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const a = args as Record<string, unknown>;
	switch (toolName) {
		case "bash":
			return typeof a.command === "string"
				? truncateToWidth(a.command.split("\n")[0], 50, "…")
				: "";
		case "read":
		case "write":
		case "edit":
			return typeof a.path === "string" ? a.path : "";
		default: {
			const v = Object.values(a)[0];
			return typeof v === "string" ? truncateToWidth(v.split("\n")[0], 40, "…") : "";
		}
	}
}

function generateSlotId(): string {
	return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSlotTitle(question: string): string {
	const first = question.trim().split("\n")[0];
	return first.length > 40 ? first.slice(0, 37) + "…" : first;
}

function createEmptyPending(): BtwPendingState {
	return { question: null, answer: "", error: null, toolCalls: new Map(), statusText: "" };
}

function createSlot(id: string, title: string): BtwSlotState {
	const now = Date.now();
	return {
		id,
		title,
		thread: [],
		draft: "",
		busy: false,
		pending: createEmptyPending(),
		runtime: null,
		createdAt: now,
		updatedAt: now,
	};
}

// ── Overlay widget ───────────────────────────────────────────────────

class BtwOverlay extends Container implements Focusable {
	private readonly input: Input;
	private readonly tui: TUI;
	private readonly theme: ExtensionContext["ui"]["theme"];
	private readonly keybindings: KeybindingsManager;
	private readonly getTranscript: (
		width: number,
		theme: ExtensionContext["ui"]["theme"],
	) => string[];
	private readonly getTabStrip: (
		width: number,
		theme: ExtensionContext["ui"]["theme"],
	) => string | null;
	private readonly getStatus: () => string;
	private readonly onSubmitCb: (value: string) => void;
	private readonly onDismissCb: () => void;
	private readonly onCycleTabCb: (direction: 1 | -1) => void;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(
		tui: TUI,
		theme: ExtensionContext["ui"]["theme"],
		keybindings: KeybindingsManager,
		getTranscript: (width: number, theme: ExtensionContext["ui"]["theme"]) => string[],
		getTabStrip: (width: number, theme: ExtensionContext["ui"]["theme"]) => string | null,
		getStatus: () => string,
		onSubmit: (value: string) => void,
		onDismiss: () => void,
		onCycleTab: (direction: 1 | -1) => void,
	) {
		super();
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.getTranscript = getTranscript;
		this.getTabStrip = getTabStrip;
		this.getStatus = getStatus;
		this.onSubmitCb = onSubmit;
		this.onDismissCb = onDismiss;
		this.onCycleTabCb = onCycleTab;

		this.input = new Input();
		this.input.onSubmit = (v) => this.onSubmitCb(v);
		this.input.onEscape = () => this.onDismissCb();
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "selectCancel")) {
			this.onDismissCb();
			return;
		}
		// Tab / Shift+Tab to cycle slots
		if (data === "\t") {
			this.onCycleTabCb(1);
			return;
		}
		if (data === "\x1b[Z") {
			// Shift+Tab
			this.onCycleTabCb(-1);
			return;
		}
		this.input.handleInput(data);
	}

	setDraft(v: string): void {
		this.input.setValue(v);
		this.tui.requestRender();
	}
	getDraft(): string {
		return this.input.getValue();
	}

	private frame(content: string, iw: number): string {
		const truncated = truncateToWidth(content, iw, "");
		const pad = Math.max(0, iw - visibleWidth(truncated));
		return `${this.theme.fg("borderMuted", "│")}${truncated}${" ".repeat(pad)}${this.theme.fg("borderMuted", "│")}`;
	}

	private border(iw: number, edge: "top" | "bottom"): string {
		const [l, r] = edge === "top" ? ["┌", "┐"] : ["└", "┘"];
		return this.theme.fg("borderMuted", `${l}${"─".repeat(iw)}${r}`);
	}

	override render(width: number): string[] {
		const dw = Math.max(56, Math.min(width, Math.floor(width * 0.9)));
		const iw = Math.max(40, dw - 2);
		const rows = process.stdout.rows ?? 30;
		const dh = Math.max(16, Math.min(30, Math.floor(rows * 0.75)));

		const tabStrip = this.getTabStrip(iw, this.theme);
		const hasMultiSlots = tabStrip !== null;

		// Chrome: top border, title, [tab strip], separator, separator, status, input, help, bottom border
		const chromeHeight = hasMultiSlots ? 9 : 8;
		const transcriptHeight = Math.max(6, dh - chromeHeight);

		const transcript = this.getTranscript(iw, this.theme);
		const visibleTranscript = transcript.slice(-transcriptHeight);
		const transcriptPadding = Math.max(0, transcriptHeight - visibleTranscript.length);

		const status = this.getStatus();

		const prevFocused = this.input.focused;
		this.input.focused = false;
		const inputLine = this.input.render(iw)[0] ?? "";
		this.input.focused = prevFocused;

		const helpHints = hasMultiSlots
			? "Enter submit · Tab switch · Esc hide"
			: "Enter submit · Esc hide";

		const lines = [this.border(iw, "top")];
		lines.push(
			this.frame(this.theme.fg("accent", this.theme.bold(" BTW side chat ")), iw),
		);
		if (hasMultiSlots) {
			lines.push(this.frame(tabStrip!, iw));
		}
		lines.push(this.theme.fg("borderMuted", `├${"─".repeat(iw)}┤`));

		for (const line of visibleTranscript) lines.push(this.frame(line, iw));
		for (let i = 0; i < transcriptPadding; i++) lines.push(this.frame("", iw));

		lines.push(this.theme.fg("borderMuted", `├${"─".repeat(iw)}┤`));
		lines.push(this.frame(this.theme.fg("warning", status), iw));
		lines.push(
			`${this.theme.fg("borderMuted", "│")}${inputLine}${this.theme.fg("borderMuted", "│")}`,
		);
		lines.push(this.frame(this.theme.fg("dim", helpHints), iw));
		lines.push(this.border(iw, "bottom"));

		return lines;
	}
}

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const store: BtwStore = { slots: new Map(), order: [], activeSlotId: null };
	const queue: QueueItem[] = [];
	let executing = false;
	let overlayRuntime: OverlayRuntime | null = null;
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	let lastCtx: ExtensionContext | null = null;
	const mdTheme = getMarkdownTheme();

	// ── Store accessors ──────────────────────────────────────────────

	function activeSlot(): BtwSlotState | null {
		return store.activeSlotId ? (store.slots.get(store.activeSlotId) ?? null) : null;
	}

	/** Save the current overlay input text to the active slot's draft before switching. */
	function saveActiveDraft(): void {
		const current = activeSlot();
		if (current && overlayRuntime?.getDraft) {
			current.draft = overlayRuntime.getDraft();
		}
	}

	/** Load the active slot's draft into the overlay input. */
	function loadActiveDraft(): void {
		const current = activeSlot();
		if (current && overlayRuntime?.setDraft) {
			overlayRuntime.setDraft(current.draft);
		}
	}

	function setActive(slotId: string): void {
		if (store.slots.has(slotId)) {
			saveActiveDraft();
			store.activeSlotId = slotId;
			loadActiveDraft();
		}
	}

	function addSlot(slot: BtwSlotState): void {
		saveActiveDraft();
		store.slots.set(slot.id, slot);
		if (!store.order.includes(slot.id)) store.order.push(slot.id);
		store.activeSlotId = slot.id;
		loadActiveDraft();
	}

	async function removeSlot(slotId: string): Promise<void> {
		const slot = store.slots.get(slotId);
		if (!slot) return;
		// Remove from store BEFORE awaiting abort to prevent late commits
		store.slots.delete(slotId);
		store.order = store.order.filter((id) => id !== slotId);
		// Remove queued items for this slot
		for (let i = queue.length - 1; i >= 0; i--) {
			if (queue[i].slotId === slotId) queue.splice(i, 1);
		}
		// Now safely dispose runtime
		await disposeSlotRuntime(slot);
		// Pick new active: most recently updated surviving slot
		if (store.activeSlotId === slotId) {
			store.activeSlotId = null;
			let latest: BtwSlotState | null = null;
			for (const s of store.slots.values()) {
				if (!latest || s.updatedAt > latest.updatedAt) latest = s;
			}
			if (latest) store.activeSlotId = latest.id;
			loadActiveDraft();
		}
	}

	async function doArchiveSlot(slotId: string): Promise<void> {
		await removeSlot(slotId);
		pi.appendEntry(BTW_SLOT_ARCHIVE, {
			slotId,
			timestamp: Date.now(),
		} as PersistedBtwArchive);
	}

	function ensureActiveSlot(): BtwSlotState {
		let slot = activeSlot();
		if (!slot) {
			slot = createSlot(generateSlotId(), "New chat");
			addSlot(slot);
		}
		return slot;
	}

	function cycleActiveSlot(dir: 1 | -1): void {
		if (store.order.length <= 1) return;
		const idx = store.activeSlotId ? store.order.indexOf(store.activeSlotId) : 0;
		const next = (idx + dir + store.order.length) % store.order.length;
		store.activeSlotId = store.order[next];
	}

	// ── Runtime management ───────────────────────────────────────────

	/** Track a dispose generation to detect late commits after abort. */
	let disposeGeneration = 0;
	let disposing = false;

	async function disposeSlotRuntime(slot: BtwSlotState): Promise<void> {
		const rt = slot.runtime;
		if (!rt) return;
		slot.runtime = null;
		try {
			rt.unsubscribe();
		} catch {
			/* ignore */
		}
		try {
			await rt.session.abort();
		} catch {
			/* ignore */
		}
		try {
			rt.session.dispose();
		} catch {
			/* ignore */
		}
	}

	async function disposeAllRuntimes(): Promise<void> {
		disposing = true;
		disposeGeneration++;
		queue.length = 0;
		executing = false;
		const promises: Promise<void>[] = [];
		for (const slot of store.slots.values()) {
			slot.busy = false;
			slot.pending = createEmptyPending();
			promises.push(disposeSlotRuntime(slot));
		}
		await Promise.all(promises);
		disposing = false;
	}

	// ── Rendering ────────────────────────────────────────────────────

	function renderMd(text: string, width: number): string[] {
		if (!text) return [];
		try {
			return new Markdown(text, 0, 0, mdTheme).render(width);
		} catch {
			return text.split("\n").flatMap((l) => {
				if (!l) return [""];
				const wrapped: string[] = [];
				for (let i = 0; i < l.length; i += width) wrapped.push(l.slice(i, i + width));
				return wrapped.length ? wrapped : [""];
			});
		}
	}

	function renderToolCalls(
		tcs: Map<string, ToolCallInfo>,
		theme: ExtensionContext["ui"]["theme"],
		width: number,
	): string[] {
		return [...tcs.values()].map((tc) => {
			const icon = tc.status === "running" ? "⚙" : tc.status === "error" ? "✗" : "✓";
			const color: string =
				tc.status === "error" ? "error" : tc.status === "done" ? "success" : "dim";
			const label = theme.fg(color, `${icon} `) + theme.fg("toolTitle", tc.toolName);
			const argsText = tc.args ? theme.fg("dim", ` ${tc.args}`) : "";
			return truncateToWidth(`  ${label}${argsText}`, width, "");
		});
	}

	function getTabStripLine(
		width: number,
		theme: ExtensionContext["ui"]["theme"],
	): string | null {
		if (store.order.length <= 1) return null;
		const parts: string[] = [];
		for (let i = 0; i < store.order.length; i++) {
			const slot = store.slots.get(store.order[i]);
			if (!slot) continue;
			const num = i + 1;
			const icon = slot.busy ? " ⏳" : slot.thread.length > 0 ? " ✓" : "";
			const title = truncateToWidth(slot.title, 20, "…");
			const label = `${num}. ${title}${icon}`;
			const isActive = slot.id === store.activeSlotId;
			parts.push(isActive ? theme.bold(`[${label}]`) : theme.fg("dim", ` ${label} `));
		}
		return truncateToWidth(parts.join(" "), width, "…");
	}

	function getOverlayStatus(): string {
		const slot = activeSlot();
		if (!slot) return "Type a question below";
		if (slot.busy && slot.pending.statusText) return slot.pending.statusText;
		if (slot.busy) return "Running…";
		if (slot.pending.error) return "Error — see above";
		return slot.thread.length > 0 ? "Ready" : "Type a question below";
	}

	function getTranscriptLines(
		width: number,
		theme: ExtensionContext["ui"]["theme"],
	): string[] {
		try {
			return getTranscriptInner(width, theme);
		} catch (e) {
			return [
				theme.fg(
					"error",
					`Render error: ${e instanceof Error ? e.message : String(e)}`,
				),
			];
		}
	}

	function getTranscriptInner(
		width: number,
		theme: ExtensionContext["ui"]["theme"],
	): string[] {
		const slot = activeSlot();
		if (!slot) return [theme.fg("dim", "No active slot. Type a question or use /btw:new.")];

		const lines: string[] = [];

		// Completed thread exchanges
		for (const item of slot.thread.slice(-6)) {
			if (lines.length > 0) {
				lines.push("");
				lines.push(theme.fg("dim", "───"));
				lines.push("");
			}
			const q = item.question.trim().split("\n")[0];
			lines.push(
				theme.fg("accent", theme.bold("You: ")) +
					truncateToWidth(q, width - 8, "…"),
			);
			lines.push("");
			lines.push(...renderMd(item.answer, width));
		}

		// Pending exchange (in-flight)
		const p = slot.pending;
		if (p.question) {
			if (lines.length > 0) {
				lines.push("");
				lines.push(theme.fg("dim", "───"));
				lines.push("");
			}
			const q = p.question.trim().split("\n")[0];
			const icon = slot.busy ? "⚙" : p.error ? "✗" : "✓";
			const iconColor: string = slot.busy
				? "warning"
				: p.error
					? "error"
					: "success";
			lines.push(
				theme.fg(iconColor, icon + " ") +
					theme.fg("accent", theme.bold("You: ")) +
					truncateToWidth(q, width - 10, "…"),
			);
			if (p.toolCalls.size > 0) lines.push(...renderToolCalls(p.toolCalls, theme, width));
			if (p.error) {
				lines.push(theme.fg("error", `❌ ${p.error}`));
			} else if (p.answer) {
				lines.push("");
				lines.push(...renderMd(p.answer, width));
			} else if (slot.busy && p.toolCalls.size === 0) {
				lines.push(theme.fg("dim", "  …"));
			}
		}

		if (lines.length === 0)
			return [theme.fg("dim", "Empty slot. Type a question below.")];
		while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
		return lines;
	}

	// ── Widget (status when overlay hidden) ──────────────────────────

	function updateWidget(): void {
		if (!lastCtx?.hasUI) return;
		try {
			// When overlay is visible, hide widget
			if (overlayRuntime?.handle) {
				lastCtx.ui.setWidget("btw", undefined);
				return;
			}
			if (store.slots.size === 0) {
				lastCtx.ui.setWidget("btw", undefined);
				return;
			}
			const running = [...store.slots.values()].filter((s) => s.busy).length;
			const ready = store.slots.size - running;
			const parts: string[] = [];
			if (running > 0) parts.push(`${running} running`);
			if (ready > 0) parts.push(`${ready} ready`);
			lastCtx.ui.setWidget("btw", [`BTW: ${parts.join(", ")} — /btw to open`]);
		} catch {
			/* widget API may not be available in all modes */
		}
	}

	// ── Overlay management ───────────────────────────────────────────

	function syncOverlay(): void {
		overlayRuntime?.refresh?.();
		updateWidget();
	}

	function scheduleRefresh(): void {
		if (refreshTimer) return;
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			syncOverlay();
		}, 16);
	}

	function dismissOverlay(): void {
		overlayRuntime?.close?.();
		overlayRuntime = null;
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
		updateWidget();
	}

	async function ensureOverlay(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) return;
		if (overlayRuntime?.handle) {
			overlayRuntime.handle.setHidden(false);
			overlayRuntime.handle.focus();
			// Sync draft from active slot when re-opening overlay
			loadActiveDraft();
			overlayRuntime.refresh?.();
			return;
		}
		const runtime: OverlayRuntime = {};
		const closeRuntime = () => {
			if (runtime.closed) return;
			runtime.closed = true;
			runtime.handle?.hide();
			if (overlayRuntime === runtime) overlayRuntime = null;
			runtime.finish?.();
			updateWidget();
		};
		runtime.close = closeRuntime;
		overlayRuntime = runtime;

		void ctx.ui
			.custom<void>(async (tui, theme, keybindings, done) => {
				runtime.finish = () => done();

				const overlay = new BtwOverlay(
					tui,
					theme,
					keybindings,
					(w, t) => getTranscriptLines(w, t),
					(w, t) => getTabStripLine(w, t),
					() => getOverlayStatus(),
					(value) => {
						const q = value.trim();
						if (!q) return;
						const slot = ensureActiveSlot();
						slot.draft = "";
						overlay.setDraft("");
						enqueuePrompt(ctx, slot.id, q);
					},
					() => {
						// Esc = hide only, no inject/summary prompt
						const slot = activeSlot();
						if (slot) slot.draft = overlay.getDraft();
						dismissOverlay();
					},
					(dir) => {
						// Tab cycle: save draft, switch, load draft
						const oldSlot = activeSlot();
						if (oldSlot) oldSlot.draft = overlay.getDraft();
						cycleActiveSlot(dir);
						const newSlot = activeSlot();
						if (newSlot) overlay.setDraft(newSlot.draft);
						syncOverlay();
					},
				);

				overlay.focused = true;
				const slot = activeSlot();
				if (slot) overlay.setDraft(slot.draft);

				runtime.setDraft = (v) => overlay.setDraft(v);
				runtime.getDraft = () => overlay.getDraft();
				runtime.refresh = () => {
					overlay.focused = runtime.handle?.isFocused() ?? false;
					tui.requestRender();
				};
				runtime.close = () => {
					const s = activeSlot();
					if (s) s.draft = overlay.getDraft();
					closeRuntime();
				};

				if (runtime.closed) done();
				return overlay;
			}, {
				overlay: true,
				overlayOptions: {
					width: "80%",
					minWidth: 72,
					maxHeight: "78%",
					anchor: "top-center",
					margin: { top: 1, left: 2, right: 2 },
				},
				onHandle: (handle) => {
					runtime.handle = handle;
					handle.focus();
					if (runtime.closed) closeRuntime();
				},
			})
			.catch((e) => {
				if (overlayRuntime === runtime) overlayRuntime = null;
				notify(ctx, e instanceof Error ? e.message : String(e), "error");
			});
	}

	// ── Serialized queue execution ───────────────────────────────────

	function enqueuePrompt(ctx: ExtensionContext, slotId: string, question: string): void {
		if (disposing) return;
		const slot = store.slots.get(slotId);
		if (!slot) return;

		// Set title from first question
		if (slot.thread.length === 0 && !slot.pending.question) {
			slot.title = makeSlotTitle(question);
		}

		// Only set pending state if slot is not already executing.
		// If busy, the queued item will set pending when it starts executing.
		if (!slot.busy) {
			slot.pending = {
				question,
				answer: "",
				error: null,
				toolCalls: new Map(),
				statusText: "Queued…",
			};
			slot.busy = true;
		}
		slot.updatedAt = Date.now();

		queue.push({ slotId, question, ctx });
		syncOverlay();
		drainQueue();
	}

	function drainQueue(): void {
		if (disposing || executing || queue.length === 0) return;
		const item = queue.shift()!;
		const slot = store.slots.get(item.slotId);
		if (!slot) {
			// Slot was archived while queued — skip
			drainQueue();
			return;
		}
		executing = true;
		// Reset pending state for the slot that's about to execute
		slot.pending = {
			question: item.question,
			answer: "",
			error: null,
			toolCalls: new Map(),
			statusText: "Running…",
		};
		slot.busy = true;
		syncOverlay();
		executeSlotPrompt(item.ctx, slot, item.question).finally(() => {
			executing = false;
			drainQueue();
		});
	}

	async function executeSlotPrompt(
		ctx: ExtensionContext,
		slot: BtwSlotState,
		question: string,
	): Promise<void> {
		const startGeneration = disposeGeneration;
		const model = ctx.model;
		if (!model) {
			slot.pending.error = "No active model selected.";
			slot.pending.statusText = "Error";
			slot.busy = false;
			syncOverlay();
			return;
		}

		try {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				slot.pending.error = `No credentials for ${model.provider}/${model.id}`;
				slot.pending.statusText = "Error";
				slot.busy = false;
				syncOverlay();
				return;
			}

			// Create a fresh session for this slot, seeded with main context + slot thread
			const { session } = await createAgentSession({
				sessionManager: SessionManager.inMemory(),
				model,
				modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
				thinkingLevel: pi.getThinkingLevel() as SessionThinkingLevel,
				tools: codingTools,
				resourceLoader: createBtwResourceLoader(ctx),
			});

			const seedMessages = buildSeedMessages(ctx, slot.thread);
			if (seedMessages.length > 0) {
				session.agent.replaceMessages(
					seedMessages as typeof session.state.messages,
				);
			}

			// Subscribe to streaming events for this slot
			const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
				if (!slot.busy) return;
				switch (event.type) {
					case "message_start":
					case "message_update":
					case "message_end": {
						const txt = extractEventAssistantText(event.message);
						if (txt) {
							slot.pending.answer = txt;
							slot.pending.error = null;
						}
						slot.pending.statusText =
							event.type === "message_end" ? "Finalizing…" : "Streaming…";
						scheduleRefresh();
						return;
					}
					case "tool_execution_start": {
						const ev = event as {
							toolCallId?: string;
							toolName?: string;
							args?: unknown;
						};
						const tn = ev.toolName ?? "unknown";
						const tcId = ev.toolCallId ?? `tc-${Date.now()}`;
						slot.pending.toolCalls.set(tcId, {
							toolCallId: tcId,
							toolName: tn,
							args: fmtToolArgs(tn, ev.args),
							status: "running",
						});
						slot.pending.statusText = `Running: ${tn}`;
						scheduleRefresh();
						return;
					}
					case "tool_execution_end": {
						const ev = event as {
							toolCallId?: string;
							toolName?: string;
							isError?: boolean;
						};
						const tcId = ev.toolCallId ?? "";
						const tc = slot.pending.toolCalls.get(tcId);
						if (tc) tc.status = ev.isError ? "error" : "done";
						slot.pending.statusText = "Streaming…";
						scheduleRefresh();
						return;
					}
					default:
						return;
				}
			});

			slot.runtime = { session, unsubscribe };
			slot.pending.statusText = "Streaming…";
			syncOverlay();

			// Execute the prompt
			await session.prompt(question, { source: "extension" });

			const resp = getLastAssistant(session);
			if (!resp) throw new Error("No response from BTW.");
			if (resp.stopReason === "aborted") throw new Error("BTW request aborted.");
			if (resp.stopReason === "error")
				throw new Error(resp.errorMessage || "BTW request failed.");

			const answer = extractText(resp.content) || "(No text response)";
			const details: BtwDetails = {
				question,
				answer,
				timestamp: Date.now(),
				provider: model.provider,
				model: model.id,
				thinkingLevel: pi.getThinkingLevel() as SessionThinkingLevel,
				usage: resp.usage,
			};

			// Late-commit guard: if the slot was disposed/archived during execution, or
			// a global dispose happened (session switch/shutdown), don't persist
			if (!store.slots.has(slot.id) || disposeGeneration !== startGeneration) return;

			// Add to slot thread
			slot.thread.push(details);
			slot.updatedAt = Date.now();

			// Persist with slot-aware entry type
			pi.appendEntry(BTW_SLOT_ENTRY, {
				...details,
				slotId: slot.id,
			} as PersistedBtwEntry);

			// Clear pending state
			slot.pending = createEmptyPending();
		} catch (e) {
			slot.pending.error = e instanceof Error ? e.message : String(e);
			slot.pending.statusText = "Error";
		} finally {
			slot.busy = false;
			disposeSlotRuntime(slot);
			syncOverlay();
		}
	}

	// ── Restore: event replay ────────────────────────────────────────

	function restoreFromBranch(ctx: ExtensionContext): void {
		// 1. Clear all in-memory slots/runtimes
		for (const slot of store.slots.values()) disposeSlotRuntime(slot);
		store.slots.clear();
		store.order = [];
		store.activeSlotId = null;
		queue.length = 0;
		executing = false;

		const branch = ctx.sessionManager.getBranch();

		// 2. Single in-order replay pass across ALL entry types (legacy + new)
		// Legacy reset clears legacy slot. Legacy entries append to legacy slot.
		// New entries create/append/archive slots. All in branch order.
		for (const entry of branch) {
			if (entry.type !== "custom") continue;

			// Legacy reset — clear legacy slot if it exists
			if (entry.customType === BTW_LEGACY_RESET) {
				if (store.slots.has(LEGACY_SLOT_ID)) {
					store.slots.delete(LEGACY_SLOT_ID);
					store.order = store.order.filter((id) => id !== LEGACY_SLOT_ID);
				}
				continue;
			}

			// Legacy entry (no slotId) → append to legacy slot
			if (entry.customType === BTW_LEGACY_ENTRY) {
				const d = entry.data as BtwDetails | undefined;
				if (!d?.question || !d.answer) continue;
				let legacySlot = store.slots.get(LEGACY_SLOT_ID);
				if (!legacySlot) {
					legacySlot = createSlot(LEGACY_SLOT_ID, "Legacy thread");
					legacySlot.createdAt = d.timestamp;
					store.slots.set(legacySlot.id, legacySlot);
					if (!store.order.includes(legacySlot.id)) store.order.push(legacySlot.id);
				}
				legacySlot.thread.push(d);
				legacySlot.updatedAt = d.timestamp;
				continue;
			}

			// New-format entry → create/append slot
			if (entry.customType === BTW_SLOT_ENTRY) {
				const d = entry.data as PersistedBtwEntry | undefined;
				if (!d?.slotId || !d.question || !d.answer) continue;

				let slot = store.slots.get(d.slotId);
				if (!slot) {
					slot = createSlot(d.slotId, makeSlotTitle(d.question));
					slot.createdAt = d.timestamp;
					store.slots.set(slot.id, slot);
					if (!store.order.includes(slot.id)) store.order.push(slot.id);
				}
				const { slotId: _, ...details } = d;
				slot.thread.push(details);
				slot.updatedAt = d.timestamp;
				continue;
			}

			// New-format archive → remove slot immediately
			if (entry.customType === BTW_SLOT_ARCHIVE) {
				const d = entry.data as PersistedBtwArchive | undefined;
				if (d?.slotId) {
					store.slots.delete(d.slotId);
					store.order = store.order.filter((o) => o !== d.slotId);
				}
				continue;
			}
		}

		// 5. activeSlotId = most recently updated surviving slot
		store.activeSlotId = null;
		let latest: BtwSlotState | null = null;
		for (const s of store.slots.values()) {
			if (!latest || s.updatedAt > latest.updatedAt) latest = s;
		}
		if (latest) store.activeSlotId = latest.id;

		// 6. Reset all ephemeral state
		for (const slot of store.slots.values()) {
			slot.busy = false;
			slot.pending = createEmptyPending();
			slot.runtime = null;
			slot.draft = "";
		}

		syncOverlay();
	}

	// ── Summarize helper ─────────────────────────────────────────────

	async function summarizeThread(
		ctx: ExtensionContext,
		items: BtwDetails[],
	): Promise<string> {
		const model = ctx.model;
		if (!model) throw new Error("No active model selected.");
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) throw new Error(`No credentials for ${model.provider}/${model.id}.`);

		const { session } = await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			model,
			modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
			thinkingLevel: "off",
			tools: [],
			resourceLoader: createBtwResourceLoader(ctx, [BTW_SUMMARY_PROMPT]),
		});
		try {
			await session.prompt(formatThread(items), { source: "extension" });
			const resp = getLastAssistant(session);
			if (!resp) throw new Error("Summary finished without a response.");
			if (resp.stopReason === "aborted") throw new Error("Summary was aborted.");
			if (resp.stopReason === "error")
				throw new Error(resp.errorMessage || "Summary failed.");
			return extractText(resp.content) || "(No summary generated)";
		} finally {
			try {
				await session.abort();
			} catch {
				/* ignore */
			}
			session.dispose();
		}
	}

	// ── Commands ─────────────────────────────────────────────────────

	pi.registerCommand("btw", {
		description:
			"Side-chat. `/btw` opens overlay on active slot; `/btw <text>` creates a new slot with that question.",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const q = args.trim();
			if (!q) {
				// Open overlay on active slot; create empty slot if none
				ensureActiveSlot();
				await ensureOverlay(ctx);
			} else {
				// Create NEW slot, start prompt, switch overlay to it
				const slot = createSlot(generateSlotId(), makeSlotTitle(q));
				addSlot(slot);
				await ensureOverlay(ctx);
				enqueuePrompt(ctx, slot.id, q);
			}
		},
	});

	pi.registerCommand("btw:new", {
		description:
			"Create a fresh BTW slot. `/btw:new [question]` — optionally starts it.",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const q = args.trim();
			const slot = createSlot(generateSlotId(), q ? makeSlotTitle(q) : "New chat");
			addSlot(slot);
			await ensureOverlay(ctx);
			if (q) {
				enqueuePrompt(ctx, slot.id, q);
			} else {
				notify(ctx, "💭 BTW: new slot created", "info");
			}
		},
	});

	pi.registerCommand("btw:inject", {
		description:
			"Inject active slot thread into main session, then archive the slot. `/btw:inject [instructions]`",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const slot = activeSlot();
			if (!slot || slot.thread.length === 0) {
				notify(ctx, "No completed BTW thread to inject.", "warning");
				return;
			}
			const instr = args.trim();
			const threadText = formatThread(slot.thread);
			const content = instr
				? `Here's a side conversation I had. ${instr}\n\n<btw-thread>\n${threadText}\n</btw-thread>`
				: `Here's a side conversation I had for additional context:\n\n<btw-thread>\n${threadText}\n</btw-thread>`;
			if (ctx.isIdle()) pi.sendUserMessage(content);
			else pi.sendUserMessage(content, { deliverAs: "followUp" });
			const count = slot.thread.length;
			await doArchiveSlot(slot.id);
			dismissOverlay();
			notify(ctx, `💭 BTW → main: injected ${count} exchange(s)`, "info");
		},
	});

	pi.registerCommand("btw:summarize", {
		description:
			"Summarize active slot, inject summary into main session, then archive. `/btw:summarize [instructions]`",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const slot = activeSlot();
			if (!slot || slot.thread.length === 0) {
				notify(ctx, "No completed BTW thread to summarize.", "warning");
				return;
			}
			notify(ctx, "💭 BTW: summarizing…", "info");
			try {
				const summary = await summarizeThread(ctx, slot.thread);
				const instr = args.trim();
				const content = instr
					? `Here's a summary of a side conversation I had. ${instr}\n\n<btw-summary>\n${summary}\n</btw-summary>`
					: `Here's a summary of a side conversation I had:\n\n<btw-summary>\n${summary}\n</btw-summary>`;
				if (ctx.isIdle()) pi.sendUserMessage(content);
				else pi.sendUserMessage(content, { deliverAs: "followUp" });
				const count = slot.thread.length;
				await doArchiveSlot(slot.id);
				dismissOverlay();
				notify(
					ctx,
					`💭 BTW → main: injected summary of ${count} exchange(s)`,
					"info",
				);
			} catch (e) {
				notify(
					ctx,
					`BTW summarize failed: ${e instanceof Error ? e.message : String(e)}`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("btw:archive", {
		description: "Archive the active BTW slot without injection.",
		handler: async (_args, ctx) => {
			lastCtx = ctx;
			const slot = activeSlot();
			if (!slot) {
				notify(ctx, "No active BTW slot to archive.", "warning");
				return;
			}
			const title = slot.title;
			await doArchiveSlot(slot.id);
			syncOverlay();
			notify(ctx, `💭 BTW: archived "${title}"`, "info");
		},
	});

	// ── Session lifecycle: before handlers (abort running slots) ─────

	async function abortBeforeChange(): Promise<void> {
		await disposeAllRuntimes();
		dismissOverlay();
	}

	pi.on("session_before_switch", async () => {
		await abortBeforeChange();
	});
	pi.on("session_before_tree", async () => {
		await abortBeforeChange();
	});
	pi.on("session_before_fork", async () => {
		await abortBeforeChange();
	});
	pi.on("session_shutdown", async () => {
		await abortBeforeChange();
	});

	// ── Session lifecycle: after handlers (restore from branch) ──────

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		restoreFromBranch(ctx);
	});
	pi.on("session_switch", async (_event, ctx) => {
		lastCtx = ctx;
		restoreFromBranch(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		lastCtx = ctx;
		restoreFromBranch(ctx);
	});
	pi.on("session_fork", async (_event, ctx) => {
		lastCtx = ctx;
		restoreFromBranch(ctx);
	});
}
