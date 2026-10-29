// Renders the analysis as a self-contained HTML page (opened in the browser) or as plain text.
// The page is static: its only interaction is copying text, so it cannot change anything on disk.

const { t, lang, num, kindLabel } = require('./i18n');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = num;
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const label = (x) => (x.project ? `${x.project} › ${x.rel}` : x.abs || x.key);

// Real usage, from agy's transcripts: what counts against the quota, unlike the size estimate.
const billed = (u) => u.input + u.output;
const withCache = (u) => u.input + u.cache + u.output;

// --- HTML ---

function fixBlock(f) {
  return `<div class="fix${f.applied ? ' done' : ''}">
    <div class="fix-head"><b>${esc(f.title)}</b>${f.applied ? `<span class="pill">${t.report.applied}</span>` : ''}</div>
    <p class="where">${t.report.in} <code>${esc(f.file)}</code>, ${esc(f.where)}:</p>
    <div class="code"><button class="copy" type="button">${t.report.copy}</button><pre>${esc(f.text)}</pre></div>
    <p class="hint">${esc(f.note)}</p>
  </div>`;
}

function item(it) {
  const extra = it.fixes.length
    ? `<details><summary>${t.report.howToExclude}</summary>${it.fixes.map(fixBlock).join('')}</details>`
    : it.example
      ? `<details><summary>${t.report.exampleRule}</summary><div class="fix"><div class="code"><button class="copy" type="button">${t.report.copy}</button><pre>${esc(it.example)}</pre></div>
         <p class="hint">${t.report.exampleHint}</p></div></details>`
      : '';
  return `<li><div class="row"><div class="what"><span class="label">${esc(it.label)}</span><span class="detail">${esc(it.detail)}</span></div>
    <span class="num">${it.tokens ? `~${fmt(it.tokens)}` : ''}</span></div>${extra}</li>`;
}

function finding(f, total) {
  return `<section class="finding ${f.level}">
    <h3>${esc(f.title)}${f.tokens ? ` <span class="tok">~${fmt(f.tokens)} tokens · ${pct(f.tokens, total)}</span>` : ''}</h3>
    <p>${esc(f.why)}</p><p class="hint">${esc(f.suggestion)}</p>
    ${f.items.length ? `<ul class="items">${f.items.map(item).join('')}</ul>` : ''}
  </section>`;
}

function table(title, rows, total, name = label) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => r.tokens), 1);
  return `<h3>${esc(title)}</h3><div class="scroll"><table><thead><tr>${t.report.cols.map((c, i) => `<th${i ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>
  ${rows.slice(0, 15).map((r) => `<tr><td><div class="bar" style="--w:${((100 * r.tokens) / max).toFixed(1)}%"></div><span>${esc(name(r))}</span></td>
    <td class="num">${fmt(r.tokens)}</td><td class="num">${pct(r.tokens, total)}</td><td class="num">${r.calls}</td><td class="num">${r.convs || ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function sessionsTable(r) {
  const rows = r.sessions.filter((s) => s.usage).slice(0, 15);
  if (!rows.length) return '';
  const max = Math.max(...rows.map((s) => billed(s.usage)), 1);
  return `<h3>${t.report.sessionsTitle}</h3><div class="scroll"><table><thead><tr>${t.report.sessionCols.map((c, i) => `<th${i ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>
  ${rows.map((s) => `<tr><td><div class="bar" style="--w:${((100 * billed(s.usage)) / max).toFixed(1)}%"></div><span>${esc(s.id.slice(0, 8))}</span></td>
    <td class="num">${fmt(billed(s.usage))}</td><td class="num">${pct(billed(s.usage), billed(r.usage))}</td><td class="num">${fmt(withCache(s.usage))}</td>
    <td class="num">${s.usage.calls}</td><td class="num">${s.usage.errors || ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function html(r, found, { scope }) {
  const top5 = r.sessions.slice(0, 5).reduce((s, x) => s + x.tokens, 0);
  const u = r.usage;
  const body = !r.conversations
    ? `<p>${t.report.noConversations(scope && esc(scope), esc(r.dir))}</p>`
    : `<div class="tiles">
        ${u.conversations ? `<div><b>${fmt(billed(u))}</b><span>${t.report.tileReal}</span></div>
        <div><b>${fmt(withCache(u))}</b><span>${t.report.tileCache(u.calls)}</span></div>` : ''}
        <div><b>${fmt(r.tokens)}</b><span>${t.report.tileContext}</span></div>
        <div><b>${pct(top5, r.tokens)}</b><span>${t.report.tileTop5}</span></div>
        <div><b>${r.reads}</b><span>${t.report.tileReads}</span></div>
        <div><b>${pct(r.rereads, r.reads)}</b><span>${t.report.tileRereads}</span></div>
      </div>
      <h2>${t.report.happening}</h2>
      <p class="hint">${t.report.happeningHint}</p>
      ${found.length ? found.map((f) => finding(f, r.tokens)).join('') : `<p>${t.report.nothing}</p>`}
      <details class="detail-all"><summary><h2>${t.report.details}</h2></summary>
        ${sessionsTable(r)}
        ${table(t.report.byProject, r.projects, r.tokens, (x) => x.project || t.report.outsideGit)}
        ${table(t.report.byKind, r.kinds, r.tokens, (x) => kindLabel(x.key))}
        ${table(t.report.byFolder, r.folders, r.tokens)}
        ${table(t.report.files, r.files, r.tokens)}
        ${table(t.report.tools, r.tools, r.tokens, (x) => x.key)}
        ${table(t.report.commands, r.commands, r.tokens, (x) => x.key)}
      </details>`;

  return `<!doctype html><html lang="${lang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>agy-insights</title>
<style>
  :root { --bg: #f7f8f7; --surface: #fff; --fg: #1d2421; --muted: #5d6963; --line: #dde3df; --accent: #1f7a5a; --accent-soft: #e3f1ea;
    --warn: #b06a00; --code: #eef1ef; --bar: #1f7a5a; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141917; --surface: #1b211e; --fg: #e3e9e5; --muted: #9aa8a0; --line: #2c3530;
    --accent: #5cc79c; --accent-soft: #1d3329; --warn: #e2a64a; --code: #222a26; --bar: #5cc79c; color-scheme: dark; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 20px; margin: 32px 0 6px; display: inline-block; } h3 { font-size: 16px; margin: 0 0 6px; }
  .meta, .hint, .detail, .tok, .where { color: var(--muted); } .tok { font-weight: normal; font-size: 14px; }
  code, pre { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 13px; }
  code { background: var(--code); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 20px 0; }
  .tiles div { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
  .tiles b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; } .tiles span { color: var(--muted); font-size: 14px; }
  .finding { background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 8px; padding: 14px 16px; margin: 12px 0; }
  .finding.warn { border-left-color: var(--warn); } .finding p { margin: 4px 0; }
  .items { list-style: none; margin: 10px 0 0; padding: 0; }
  .items > li { border-top: 1px solid var(--line); padding: 8px 0; }
  .row { display: flex; gap: 12px; align-items: baseline; justify-content: space-between; }
  .what { min-width: 0; } .label { display: block; word-break: break-all; } .detail { display: block; font-size: 13px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  details > summary { cursor: pointer; color: var(--accent); font-size: 14px; margin-top: 4px; }
  .fix { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; margin: 8px 0; }
  .fix.done { opacity: .6; } .fix-head { display: flex; gap: 8px; align-items: center; }
  .pill { font-size: 12px; background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 1px 8px; }
  .where, .hint { font-size: 13px; margin: 4px 0; }
  .code { position: relative; background: var(--code); border-radius: 6px; }
  .code pre { margin: 0; padding: 10px 70px 10px 12px; overflow-x: auto; white-space: pre; }
  .copy { position: absolute; top: 6px; right: 6px; font: 12px system-ui, sans-serif; color: var(--fg); background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 3px 9px; cursor: pointer; }
  .copy:focus-visible { outline: 2px solid var(--accent); }
  .scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 6px 0 18px; }
  th { text-align: left; color: var(--muted); font-weight: 600; } th, td { padding: 5px 8px; border-bottom: 1px solid var(--line); }
  td:first-child { position: relative; word-break: break-all; }
  .bar { position: absolute; inset: 3px auto 3px 0; width: var(--w); background: var(--bar); opacity: .15; border-radius: 3px; } td span { position: relative; }
  .detail-all > summary { color: var(--fg); }
  footer { margin-top: 32px; font-size: 13px; color: var(--muted); }
</style></head><body><main>
  <h1>${t.report.title}</h1>
  <p class="meta">${scope ? `${t.report.project} <code>${esc(scope)}</code>` : t.report.wholeHistory} · ${t.report.meta(r.conversations, esc(new Date().toLocaleString(t.locale)))}</p>
  ${body}
  <footer>${esc(t.report.footerReal(r.conversations - u.conversations))}
  ${esc(t.report.footerCache)}
  ${esc(t.report.footerEstimate)}
  ${esc(t.report.footerPrivacy)}</footer>
</main>
<script>
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.copy'); if (!b) return;
    const pre = b.parentElement.querySelector('pre');
    const ok = () => { b.textContent = ${JSON.stringify(t.report.copied)}; setTimeout(() => (b.textContent = ${JSON.stringify(t.report.copy)}), 1500); };
    (navigator.clipboard ? navigator.clipboard.writeText(pre.textContent) : Promise.reject()).then(ok).catch(() => {
      const range = document.createRange(); range.selectNodeContents(pre);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    });
  });
</script></body></html>`;
}

// --- Text ---

function text(r, found, { scope, paths }) {
  const top5 = r.sessions.slice(0, 5).reduce((s, x) => s + x.tokens, 0);
  const out = [`\n${t.report.history}: ${r.dir} (${r.backend})${scope ? ` · ${t.report.projectLower} ${scope}` : ''}`,
    t.report.summary(r.conversations, r.steps, fmt(r.tokens))];
  if (!r.conversations) return out.join('\n') + '\n';
  const u = r.usage;
  if (u.conversations) {
    out.push(t.report.realUsage(fmt(billed(u)), fmt(u.input), fmt(u.output), fmt(withCache(u)), u.calls)
      + (u.conversations < r.conversations ? t.report.noLog(r.conversations - u.conversations) : ''));
    const top = r.sessions.filter((s) => s.usage).slice(0, 5);
    out.push(t.report.topSessions(top.length));
    for (const s of top) {
      out.push(`    ${fmt(billed(s.usage)).padStart(10)}  ${pct(billed(s.usage), billed(u)).padStart(4)}  ${t.report.sessionLine(s.id.slice(0, 8), s.usage.calls, s.usage.errors, fmt(withCache(s.usage)))}`);
    }
  }
  out.push(t.report.top5(pct(top5, r.tokens), r.reads, r.rereads, pct(r.rereads, r.reads)));
  for (const f of found) {
    out.push('', `${f.level === 'warn' ? '⚠' : '•'} ${f.title}${f.tokens ? `  (~${fmt(f.tokens)} tokens, ${pct(f.tokens, r.tokens)})` : ''}`,
      `  ${f.why}`, `  → ${f.suggestion}`);
    // Only file and folder labels are paths; commands and session ids are always shown.
    const hasPaths = ['rereads', 'non-source', 'cross-session'].includes(f.id);
    for (const it of f.items) {
      out.push(`    ${(it.tokens ? `~${fmt(it.tokens)}` : '').padStart(10)}  ${paths || !hasPaths ? it.label : t.report.pathHidden}  ${it.detail || ''}`);
      if (paths) for (const x of it.fixes.filter((x) => !x.applied)) out.push(`${' '.repeat(16)}${x.title}: ${x.text.split('\n').join(' ')}  →  ${x.file}`);
    }
  }
  out.push('', t.report.byKindText);
  for (const k of r.kinds.slice(0, 10)) out.push(`  ${`~${fmt(k.tokens)}`.padStart(10)}  ${String(k.calls).padStart(5)}×  ${kindLabel(k.key)}`);
  out.push('', t.report.textFooter, '');
  return out.join('\n');
}

module.exports = { html, text };
