export const CONFIRMATION_HTML = (
	question: string,
	plan: string,
	diff: string,
	esc: (s: string) => string,
	mdToHtml: (md: string) => string,
	diffHtml: string,
	addCount: number,
	delCount: number,
): string => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🏗️ Changes Applied</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;padding:28px 32px;max-width:960px;margin:0 auto;line-height:1.5}
h2{font-size:16px;color:#58a6ff;margin-bottom:14px}
.plan{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 18px;margin-bottom:18px;font-size:13px;line-height:1.6}
.plan h3{color:#f0f6fc;font-size:14px;margin:10px 0 4px}.plan h4{color:#c9d1d9;font-size:13px;margin:8px 0 3px}
.plan li{margin:2px 0 2px 16px;list-style:disc}.plan code{background:#21262d;padding:1px 5px;border-radius:3px;font-size:12px}
.diff-wrap{background:#161b22;border:1px solid #30363d;border-radius:8px;margin-bottom:18px;overflow:hidden}
.diff-hdr{padding:7px 14px;font-size:11px;color:#8b949e;border-bottom:1px solid #30363d;font-family:monospace;display:flex;justify-content:space-between}
.diff-stats{display:flex;gap:10px}.stat-add{color:#3fb950}.stat-del{color:#ff7b72}
.diff-pre{padding:12px;font-family:'Fira Code',Consolas,monospace;font-size:12px;line-height:1.55;overflow-x:auto;white-space:pre;margin:0}
.da{color:#3fb950;display:block}.dd{color:#ff7b72;display:block}.dh{color:#79c0ff;display:block}.df{color:#8b949e;display:block}.dc{color:#e6edf3;display:block}
.actions{display:flex;gap:10px;flex-wrap:wrap}
.btn-c{background:#238636;color:#fff;border:1px solid #2ea043;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}.btn-c:hover{background:#2ea043}
.btn-chat{background:#1a2332;color:#79c0ff;border:1px solid #1f6feb;padding:10px 24px;border-radius:6px;font-size:14px;cursor:pointer}.btn-chat:hover{background:#1f3050}
.chat-area{display:none;margin-top:12px}
textarea{width:100%;background:#161b22;border:1px solid #30363d;color:#e6edf3;padding:9px;border-radius:6px;font-family:inherit;font-size:13px;resize:vertical;min-height:72px;outline:none}
textarea:focus{border-color:#58a6ff}
.hint{color:#6e7681;font-size:12px;margin-top:10px}
</style></head><body>
<h2>${esc(question)}</h2>
<div class="plan"><p>${mdToHtml(plan)}</p></div>
${diff ? `<div class="diff-wrap"><div class="diff-hdr"><span>Changes</span><div class="diff-stats"><span class="stat-add">+${addCount}</span><span class="stat-del">−${delCount}</span></div></div><pre class="diff-pre">${diffHtml}</pre></div>` : ""}
<form method="POST" id="f">
<input type="hidden" name="choice" id="c" value="Looks good">
<div class="actions">
<button class="btn-c" type="submit">✅ Looks good — move to next offender</button>
<button class="btn-chat" type="button" onclick="toggleChat()">💬 Request changes</button>
</div>
<div class="chat-area" id="ca"><textarea name="freeText" placeholder="Describe what you'd like changed..."></textarea>
<div style="margin-top:8px"><button class="btn-c" type="submit" onclick="document.getElementById('c').value='Redo'">Submit</button></div></div>
</form>
<p class="hint">Tab closes after submit · Ctrl+Enter to confirm</p>
<script>
function toggleChat(){const r=document.getElementById('ca');r.style.display=r.style.display==='none'?'block':'none';if(r.style.display==='block')r.querySelector('textarea').focus();}
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){document.getElementById('f').submit();}});
</script>
</body></html>`;

export const INTERVIEW_HTML = (
	question: string,
	optionsHtml: string,
	hasFreeText: boolean,
	esc: (s: string) => string,
): string => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🏗️ Decision</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;padding:28px 32px;max-width:880px;margin:0 auto;line-height:1.5}
.question{font-size:15px;font-weight:600;color:#f0f6fc;margin-bottom:12px}
.opts{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
.card{border:1px solid #30363d;border-radius:8px;padding:11px 14px;cursor:pointer;transition:border-color .12s,background .12s;display:flex;align-items:flex-start;gap:10px}
.card:hover,.card.selected{border-color:#58a6ff;background:#0d1f30}.card.rec{border-color:#1f6feb}
.card input{margin-top:3px;accent-color:#58a6ff;flex-shrink:0}.card-body{flex:1}
.card-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.num{color:#6e7681;font-size:13px;min-width:18px}.lbl{font-size:13.5px;font-weight:500}
.badge-rec{background:#1f4e2e;color:#3fb950;font-size:10px;padding:1px 7px;border-radius:10px;margin-left:4px;font-weight:600}
.ctx{color:#8b949e;font-size:12px;margin-top:3px;padding-left:22px}
.impact{display:flex;gap:6px;margin-top:5px;padding-left:22px;flex-wrap:wrap}
.ib{font-size:11px;padding:2px 8px;border-radius:10px;font-family:monospace;font-weight:600}
.ib.up{background:#1a3a2a;color:#3fb950;border:1px solid #238636}
.ib.dn{background:#3a1a1a;color:#ff7b72;border:1px solid #f85149}
.ib.proj{background:#1a2a3a;color:#79c0ff;border:1px solid #1f6feb}
.free-area{display:none;margin-top:10px;padding-left:22px}
textarea{width:100%;background:#161b22;border:1px solid #30363d;color:#e6edf3;padding:9px;border-radius:6px;font-family:inherit;font-size:13px;resize:vertical;min-height:72px;outline:none}
textarea:focus{border-color:#58a6ff}
.submit-row{display:flex;align-items:center;gap:12px;margin-top:4px}
button{background:#238636;color:#fff;border:1px solid #2ea043;padding:9px 22px;border-radius:6px;font-size:13.5px;font-weight:600;cursor:pointer;transition:background .12s}
button:hover{background:#2ea043}.hint{color:#6e7681;font-size:12px}
</style></head><body>
<div class="question">${esc(question)}</div>
<form method="POST" id="f">
<div class="opts">${optionsHtml}</div>
${hasFreeText ? '<div class="free-area" id="fa"><textarea name="freeText" placeholder="Describe your preferred approach..."></textarea></div>' : ""}
<div class="submit-row"><button type="submit">Submit</button><span class="hint">Ctrl+Enter</span></div>
</form>
<script>
const cards=document.querySelectorAll('.card');function sel(c){cards.forEach(x=>{x.classList.remove('selected');x.querySelector('input').checked=false});c.classList.add('selected');c.querySelector('input').checked=true;const fa=document.getElementById('fa');if(fa)fa.style.display=c.querySelector('input').value==='__free__'?'block':'none';}
cards.forEach(c=>c.addEventListener('click',()=>sel(c)));const rec=document.querySelector('.card.rec');if(rec)sel(rec);else if(cards.length)sel(cards[0]);
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')document.getElementById('f').submit();});
</script></body></html>`;
