import { spawnSync } from "node:child_process";
import * as http from "node:http";
import * as net from "node:net";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { CONFIRMATION_HTML, INTERVIEW_HTML } from "./interviewer-templates.js";

export type InterviewOption = {
	value: string;
	label: string;
	context?: string;
	recommended?: boolean;
	impact?: {
		linesReduced?: number;
		miProjection?: string;
		cognitiveProjection?: string;
	};
};

export function buildInterviewer(
	pi: ExtensionAPI,
	_dbg: (msg: string) => void,
): (
	question: string,
	options: InterviewOption[],
	timeoutSeconds: number,
	plan?: string,
	diff?: string,
	confirmationMode?: boolean,
) => Promise<string | null> {
	let interviewHandler:
		| ((
				question: string,
				options: InterviewOption[],
				timeoutSeconds: number,
				plan?: string,
				diff?: string,
				confirmationMode?: boolean,
		  ) => Promise<string | null>)
		| null = null;

	const esc = (s: string) =>
		s
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");

	const mdToHtml = (md: string) =>
		md
			.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
			.replace(/`([^`]+)`/g, "<code>$1</code>")
			.replace(/^### (.+)/gm, "<h4>$1</h4>")
			.replace(/^## (.+)/gm, "<h3>$1</h3>")
			.replace(/^# (.+)/gm, "<h2>$1</h2>")
			.replace(/^- (.+)/gm, "<li>$1</li>")
			.replace(/\n\n/g, "</p><p>");

	const confirmationHTML = (
		question: string,
		plan: string,
		diff: string,
	): string => {
		const diffLines = diff.split("\n");
		const diffHtml = diffLines
			.map((line) => {
				if (line.startsWith("+++") || line.startsWith("---"))
					return `<span class="df">${esc(line)}</span>`;
				if (line.startsWith("@@"))
					return `<span class="dh">${esc(line)}</span>`;
				if (line.startsWith("+")) return `<span class="da">${esc(line)}</span>`;
				if (line.startsWith("-")) return `<span class="dd">${esc(line)}</span>`;
				return `<span class="dc">${esc(line)}</span>`;
			})
			.join("\n");
		const addCount = (diff.match(/^\+/gm) || []).length;
		const delCount =
			(diff.match(/^-/gm) || []).length - (diff.match(/^---/gm) || []).length;

		return CONFIRMATION_HTML(
			question,
			plan,
			diff,
			esc,
			mdToHtml,
			diffHtml,
			addCount,
			delCount,
		);
	};

	const interviewHTML = (
		question: string,
		options: InterviewOption[],
		_timeoutSeconds: number,
		_plan?: string,
		_diff?: string,
		_confirmationMode?: boolean,
	): string => {
		if (_confirmationMode && _plan && _diff)
			return confirmationHTML(question, _plan, _diff);

		const optionsHtml = options
			.map((opt, idx) => {
				const impactBadge = (val: number, label: string, good: boolean) =>
					`<span class="ib ${good ? "up" : "dn"}">${val > 0 ? "+" : ""}${val} ${label}</span>`;
				let impactHtml = "";
				if (opt.impact) {
					const parts: string[] = [];
					if (opt.impact.linesReduced !== undefined)
						parts.push(impactBadge(opt.impact.linesReduced, "lines", true));
					if (opt.impact.miProjection)
						parts.push(
							`<span class="ib proj">MI ${opt.impact.miProjection}</span>`,
						);
					if (opt.impact.cognitiveProjection)
						parts.push(
							`<span class="ib proj">Cognitive ${opt.impact.cognitiveProjection}</span>`,
						);
					if (parts.length)
						impactHtml = `<div class="impact">${parts.join("")}</div>`;
				}
				return `<label class="card${opt.recommended ? " rec" : ""}"><input type="radio" name="choice" value="${esc(opt.value)}"${opt.recommended ? " checked" : ""}><div class="card-body"><div class="card-top"><span class="num">${idx + 1}.</span><span class="lbl">${esc(opt.label)}</span>${opt.recommended ? '<span class="badge-rec">Recommended</span>' : ""}</div>${impactHtml}${opt.context ? `<div class="ctx">${esc(opt.context)}</div>` : ""}</div></label>`;
			})
			.join("\n");
		const hasFreeText = options.some((o) => o.value === "__free__");

		return INTERVIEW_HTML(question, optionsHtml, hasFreeText, esc);
	};

	const openBrowserInterview = (
		html: string,
		timeoutSeconds: number,
	): Promise<string | null> => {
		return new Promise((resolve) => {
			const getPort = (cb: (port: number) => void) => {
				const s = net.createServer();
				s.listen(0, () => {
					const p = (s.address() as net.AddressInfo).port;
					s.close(() => cb(p));
				});
				s.on("error", () => cb(-1));
			};
			getPort((port) => {
				if (port < 0) {
					resolve(null);
					return;
				}
				const server = http.createServer((req, res) => {
					if (req.method === "GET") {
						res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
						res.end(html);
					} else if (req.method === "POST") {
						let body = "";
						req.on("data", (c: Buffer) => {
							body += c.toString();
						});
						req.on("end", () => {
							const p = new URLSearchParams(body);
							const choice = p.get("choice") ?? "";
							const freeText = p.get("freeText") ?? "";
							const final =
								choice === "__free__" || choice === "Redo"
									? freeText.trim()
									: choice;
							res.writeHead(200, {
								"Content-Type": "text/html; charset=utf-8",
							});
							res.end(
								`<!DOCTYPE html><html><head><meta charset='UTF-8'><style>body{font-family:system-ui;background:#0d1117;color:#e6edf3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}.fade{transition:opacity 0.5s}</style></head><body><div class="fade"><h2>✅ Response received</h2><p style='color:#8b949e;margin-top:8px'>Closing tab...</p><p id="count" style='color:#58a6ff;margin-top:4px'></p></div><script>let s=3;const el=document.getElementById('count');const tick=()=>{el.textContent=s+'s';if(s<=0){window.close();}else{s--;setTimeout(tick,1000);}};tick();</script></body></html>`,
							);
							clearTimeout(timer);
							server.close();
							resolve(final || null);
						});
					}
				});
				server.listen(port);
				const url = `http://localhost:${port}`;
				if (process.platform === "win32")
					spawnSync("cmd", ["/c", "start", "", url], { shell: false });
				else if (process.platform === "darwin") spawnSync("open", [url]);
				else spawnSync("xdg-open", [url]);
				const timer = setTimeout(() => {
					server.close();
					resolve(null);
				}, timeoutSeconds * 1000);
			});
		});
	};

	interviewHandler = (
		question,
		options,
		timeoutSeconds,
		plan,
		diff,
		confirmationMode,
	) =>
		openBrowserInterview(
			interviewHTML(
				question,
				options,
				timeoutSeconds,
				plan,
				diff,
				confirmationMode,
			),
			timeoutSeconds,
		);

	pi.registerTool({
		name: "interviewer",
		label: "Interview",
		description:
			"Present a multiple-choice interview to the user via browser form. Use this when you need the user to make a decision with options. Returns their choice or null on timeout. Supports confirmation mode with plan+diff display.",
		parameters: Type.Object({
			question: Type.String({
				description: "The question to present to the user",
			}),
			options: Type.Optional(
				Type.Array(
					Type.Object({
						value: Type.String(),
						label: Type.String(),
						context: Type.Optional(Type.String()),
						recommended: Type.Optional(Type.Boolean()),
						impact: Type.Optional(
							Type.Object({
								linesReduced: Type.Optional(Type.Number()),
								miProjection: Type.Optional(Type.String()),
								cognitiveProjection: Type.Optional(Type.String()),
							}),
						),
					}),
				),
			),
			plan: Type.Optional(
				Type.String({
					description:
						"Refactoring plan (markdown) — shows in confirmation mode",
				}),
			),
			diff: Type.Optional(
				Type.String({
					description: "Unified diff text — shows in confirmation mode",
				}),
			),
			confirmationMode: Type.Optional(
				Type.Boolean({ description: "Show plan+diff confirmation screen" }),
			),
			timeoutSeconds: Type.Optional(
				Type.Number({
					description: "Auto-close after this many seconds (default 600)",
				}),
			),
		}),
		async execute(_toolCallId, input, _signal, _onUpdate, _ctx) {
			if (!interviewHandler)
				return {
					content: [
						{ type: "text" as const, text: "Interview tool not initialized" },
					],
					details: null,
				};
			const result = await interviewHandler(
				input.question,
				input.options ?? [],
				input.timeoutSeconds ?? 600,
				input.plan,
				input.diff,
				input.confirmationMode,
			);
			return {
				content: [
					{
						type: "text" as const,
						text: result ?? "No response (timed out or dismissed)",
					},
				],
				details: result ?? null,
			};
		},
	});

	return interviewHandler;
}
