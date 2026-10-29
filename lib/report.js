// Renders the analysis as a self-contained HTML page (opened in the browser) or as plain text.
// The page is static: its only interactions are switching the period, the chart tooltip and copying text,
// so it cannot change anything on disk.

const { t, lang, num, date, when, kindLabel, effortLabel } = require('./i18n');
const { dayKey } = require('./history');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = num;
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
// "Period: from 3 Oct 2026 to 29 Oct 2026 (filter: active since 1 Oct 2026)", or '' with no conversations.
const periodLine = (r) => (r.period ? t.report.periodLine(t.report.period(date(r.period.from), date(r.period.to)), r.since && t.report.since(date(r.since))) : '');
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
    <span class="num">${it.tokens ? `${it.exact ? '' : '~'}${fmt(it.tokens)}` : ''}</span></div>${extra}</li>`;
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
  return `<h3>${t.report.sessionsTitle}</h3><div class="scroll"><table><thead><tr>${t.report.sessionCols.map((c, i) => `<th${i > 2 ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>
  ${rows.map((s) => `<tr><td><div class="bar" style="--w:${((100 * billed(s.usage)) / max).toFixed(1)}%"></div><span>${esc(s.id.slice(0, 8))}</span></td><td class="when">${esc(when(s.start, s.end))}</td><td>${esc(sessionModel(s))}</td>
    <td class="num">${fmt(billed(s.usage))}</td><td class="num">${pct(billed(s.usage), billed(r.usage))}</td><td class="num">${fmt(withCache(s.usage))}</td>
    <td class="num">${s.usage.calls}</td><td class="num">${s.usage.errors || ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// "Gemini 3.8 Flash · High", or "Gemini 3.8 Flash · High +1 more" when the session used several.
const modelName = (m) => (m.model || t.report.unknownModel);
const sessionModel = (s) => (s.model ? `${modelName(s.model)} · ${effortLabel(s.model.effort)}${s.models > 1 ? t.report.otherModels(s.models - 1) : ''}` : '');

// Calls and real tokens per model and effort level.
function modelsTable(r) {
  const rows = r.models.filter((m) => m.model || m.calls);
  if (!rows.length || (rows.length === 1 && !rows[0].model)) return '';
  const total = rows.reduce((s, m) => s + m.input + m.output, 0);
  const max = Math.max(...rows.map((m) => m.input + m.output), 1);
  const unknown = rows.find((m) => !m.model);
  return `<section class="models"><h2>${t.report.modelsTitle}</h2><p class="hint">${t.report.modelsHint}</p>
    <div class="scroll"><table><thead><tr>${t.report.modelCols.map((c, i) => `<th${i > 1 ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((m) => { const tok = m.input + m.output; return `<tr><td><div class="bar" style="--w:${((100 * tok) / max).toFixed(1)}%"></div><span>${esc(modelName(m))}</span></td>
      <td>${esc(effortLabel(m.effort))}</td><td class="num">${fmt(m.calls)}</td><td class="num">${m.known ? fmt(tok) : '–'}</td><td class="num">${m.known ? pct(tok, total) : '–'}</td>
      <td class="num">${m.known ? fmt(tok / m.known) : '–'}</td><td class="num">${m.known ? fmt(tok + m.cache) : '–'}</td><td class="num">${m.convs}</td></tr>`; }).join('')}
    </tbody></table></div>${unknown ? `<p class="hint">${esc(t.report.modelsUnknown(fmt(unknown.calls)))}</p>` : ''}</section>`;
}

// --- Usage chart ---

const DAY = 24 * 60 * 60 * 1000;
const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const shortDate = (d, year) => d.toLocaleDateString(t.locale, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
const compact = (n) => new Intl.NumberFormat(t.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
// 1, 2, 2.5, 5 × 10^k: a round top for the y axis.
const niceMax = (v) => { const p = 10 ** Math.floor(Math.log10(v || 1)); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v); };

// Real usage per day (per week past ~4 months), continuous: days without calls are zero-height columns.
function buckets(r) {
  if (!r.daily.length) return null;
  const first = r.since ? parseDay(dayKey(r.since)) : parseDay(r.daily[0].day);
  const last = r.since ? parseDay(dayKey(Date.now())) : parseDay(r.daily[r.daily.length - 1].day);
  const weekly = (last - first) / DAY > 120;
  const startOf = (d) => (weekly ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)) : d);
  const byKey = new Map();
  for (let d = startOf(first); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (weekly ? 7 : 1))) {
    byKey.set(dayKey(d.getTime()), { date: d, billed: 0, cache: 0, calls: 0 });
  }
  for (const x of r.daily) {
    const b = byKey.get(dayKey(startOf(parseDay(x.day)).getTime()));
    if (!b) continue;
    b.billed += x.input + x.output;
    b.cache += x.cache;
    b.calls += x.calls;
  }
  return { weekly, rows: [...byKey.values()] };
}

function chart(r) {
  const b = buckets(r);
  if (!b) return '';
  const W = 900, H = 240, m = { l: 56, r: 8, t: 12, b: 28 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const top = niceMax(Math.max(...b.rows.map((x) => x.billed)));
  const band = pw / b.rows.length;
  const bw = Math.max(1, Math.min(24, band - 2));
  const y = (v) => m.t + ph - (v / top) * ph;
  const when = (x) => (b.weekly ? t.report.weekOf(shortDate(x.date, true)) : shortDate(x.date, true));

  const grid = [0, top / 2, top].map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
    <text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${esc(compact(v))}</text>`).join('');
  // Rounded data end (4px), square at the baseline.
  const bars = b.rows.map((x, i) => {
    const h = (x.billed / top) * ph;
    if (h <= 0) return '';
    const x0 = m.l + i * band + (band - bw) / 2, y0 = m.t + ph - h, rr = Math.min(4, h, bw / 2);
    return `<path class="col" d="M${x0},${m.t + ph}V${y0 + rr}Q${x0},${y0} ${x0 + rr},${y0}H${x0 + bw - rr}Q${x0 + bw},${y0} ${x0 + bw},${y0 + rr}V${m.t + ph}Z"/>`;
  }).join('');
  // Hit targets: the whole band, so a 2px column is as easy to hover as a 24px one.
  const hits = b.rows.map((x, i) => `<rect class="hit" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ph}"
    data-when="${esc(when(x))}" data-v="${esc(fmt(x.billed))}" data-c="${esc(fmt(x.billed + x.cache))}" data-n="${esc(t.report.chartCalls(x.calls))}"/>`).join('');
  const every = Math.max(1, Math.ceil(b.rows.length / 6));
  // A date every few columns, plus the last one when it isn't crowded by the previous label.
  const last = b.rows.length - 1;
  const ticks = b.rows.map((x, i) => (i % every === 0 || (i === last && last % every >= every / 2)) && `<text x="${i === 0 && band < 40 ? m.l : i === last && band < 40 ? W - m.r : m.l + i * band + band / 2}" y="${H - 8}" text-anchor="${i === 0 && band < 40 ? 'start' : i === last && band < 40 ? 'end' : 'middle'}" class="axis">${esc(shortDate(x.date))}</text>`).filter(Boolean).join('');

  const rows = b.rows.filter((x) => x.calls);
  return `<section class="chart">
    <h2>${b.weekly ? t.report.chartTitleWeek : t.report.chartTitleDay}</h2>
    <p class="hint">${t.report.chartHint}</p>
    <div class="plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(b.weekly ? t.report.chartTitleWeek : t.report.chartTitleDay)}">${grid}${bars}${ticks}${hits}</svg></div>
    <details><summary>${t.report.chartTable}</summary><div class="scroll"><table><thead><tr>${(b.weekly ? t.report.chartColsWeek : t.report.chartCols).map((c, i) => `<th${i ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((x) => `<tr><td>${esc(shortDate(x.date, true))}</td><td class="num">${fmt(x.billed)}</td><td class="num">${fmt(x.billed + x.cache)}</td><td class="num">${x.calls}</td></tr>`).join('')}
    </tbody></table></div></details>
  </section>`;
}

// --- Page ---

function body(r, found, scope) {
  const top5 = r.sessions.slice(0, 5).reduce((s, x) => s + x.tokens, 0);
  const u = r.usage;
  const meta = `<p class="meta">${t.report.convs(r.conversations)}${r.period ? ` · ${esc(periodLine(r))}` : ''}</p>`;
  if (!r.conversations) {
    return `${meta}<p>${t.report.noConversations(scope && esc(scope), esc(r.dir))}${r.olderSkipped ? ` ${esc(t.report.olderSkipped(r.olderSkipped))}.` : ''}</p>`;
  }
  return `${meta}<div class="tiles">
      ${u.conversations ? `<div><b>${fmt(billed(u))}</b><span>${t.report.tileReal}</span></div>
      <div><b>${fmt(withCache(u))}</b><span>${t.report.tileCache(u.calls)}</span></div>` : ''}
      <div><b>${fmt(r.tokens)}</b><span>${t.report.tileContext}</span></div>
      <div><b>${pct(top5, r.tokens)}</b><span>${t.report.tileTop5}</span></div>
      <div><b>${r.reads}</b><span>${t.report.tileReads}</span></div>
      <div><b>${pct(r.rereads, r.reads)}</b><span>${t.report.tileRereads}</span></div>
    </div>
    ${chart(r)}
    ${modelsTable(r)}
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
}

/**
 * One report per period, switched in the browser by a row of presets. Each period is analyzed on its own,
 * so every number, finding and table below the filter agrees with it.
 * @param {{ key: string, label: string, r: object, found: object[] }[]} views the first one shows by default
 */
function htmlViews(views, { scope }) {
  const u = views[0].r.usage;
  const filter = views.length > 1
    ? `<div class="filter" role="group" aria-label="${esc(t.report.filterLabel)}"><span>${t.report.filterLabel}</span>
      ${views.map((v, i) => `<button type="button" data-view="${v.key}" aria-pressed="${i === 0}">${esc(v.label)}</button>`).join('')}</div>`
    : '';
  const sections = views.map((v, i) => `<div class="view" data-view="${v.key}"${i ? ' hidden' : ''}>${body(v.r, v.found, scope)}</div>`).join('');

  return `<!doctype html><html lang="${lang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>agy-insights</title>
<style>
  :root { --bg: #f7f8f7; --surface: #fff; --fg: #1d2421; --muted: #5d6963; --line: #dde3df; --accent: #1f7a5a; --accent-soft: #e3f1ea;
    --warn: #b06a00; --code: #eef1ef; --bar: #1f7a5a; --series: #13805a; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141917; --surface: #1b211e; --fg: #e3e9e5; --muted: #9aa8a0; --line: #2c3530;
    --accent: #5cc79c; --accent-soft: #1d3329; --warn: #e2a64a; --code: #222a26; --bar: #5cc79c; --series: #33a376; color-scheme: dark; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 20px; margin: 32px 0 6px; display: inline-block; } h3 { font-size: 16px; margin: 0 0 6px; }
  .meta, .hint, .detail, .tok, .where { color: var(--muted); } .tok { font-weight: normal; font-size: 14px; }
  code, pre { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 13px; }
  code { background: var(--code); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
  .filter { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 20px 0 4px; }
  .filter span { color: var(--muted); font-size: 14px; margin-right: 4px; }
  .filter button { font: 14px system-ui, sans-serif; color: var(--fg); background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; cursor: pointer; }
  .filter button:hover { background: var(--accent-soft); }
  .filter button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--surface); font-weight: 600; }
  .filter button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 16px 0 20px; }
  .tiles div { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
  .tiles b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; } .tiles span { color: var(--muted); font-size: 14px; }
  .chart h2 { margin-top: 8px; } .models .hint { margin-top: 0; } .chart .hint { margin-top: 0; }
  .plot { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px 8px 0; }
  .plot svg { display: block; width: 100%; height: auto; }
  .grid { stroke: var(--line); stroke-width: 1; } .axis { fill: var(--muted); font: 12px system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  .col { fill: var(--series); } .hit { fill: transparent; cursor: default; } .hit:hover { fill: var(--fg); fill-opacity: .05; }
  .tip { position: fixed; pointer-events: none; background: var(--surface); color: var(--fg); border: 1px solid var(--line); border-radius: 6px;
    padding: 6px 10px; font-size: 13px; box-shadow: 0 2px 8px rgb(0 0 0 / .12); z-index: 10; }
  .tip b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; } .tip span { display: block; color: var(--muted); }
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
  td:first-child { position: relative; word-break: break-all; } td.when { white-space: nowrap; }
  .bar { position: absolute; inset: 3px auto 3px 0; width: var(--w); background: var(--bar); opacity: .15; border-radius: 3px; } td span { position: relative; }
  .detail-all > summary { color: var(--fg); }
  footer { margin-top: 32px; font-size: 13px; color: var(--muted); }
</style></head><body><main>
  <h1>${t.report.title}</h1>
  <p class="meta">${scope ? `${t.report.project} <code>${esc(scope)}</code> · ` : views[0].r.since ? '' : `${t.report.wholeHistory} · `}${esc(t.report.generated(new Date().toLocaleString(t.locale)))}</p>
  ${filter}
  ${sections}
  <footer>${esc(t.report.footerReal(views[0].r.conversations - u.conversations))}
  ${esc(t.report.footerCache)}
  ${esc(t.report.footerEstimate)}
  ${esc(t.report.footerPrivacy)}</footer>
</main>
<div class="tip" hidden><b></b><span></span><span></span></div>
<script>
  document.addEventListener('click', (e) => {
    const v = e.target.closest('.filter button');
    if (v) {
      for (const b of document.querySelectorAll('.filter button')) b.setAttribute('aria-pressed', String(b === v));
      for (const s of document.querySelectorAll('.view')) s.hidden = s.dataset.view !== v.dataset.view;
      return;
    }
    const b = e.target.closest('.copy'); if (!b) return;
    const pre = b.parentElement.querySelector('pre');
    const ok = () => { b.textContent = ${JSON.stringify(t.report.copied)}; setTimeout(() => (b.textContent = ${JSON.stringify(t.report.copy)}), 1500); };
    (navigator.clipboard ? navigator.clipboard.writeText(pre.textContent) : Promise.reject()).then(ok).catch(() => {
      const range = document.createRange(); range.selectNodeContents(pre);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    });
  });
  // Chart tooltip: values are filled with textContent, never as HTML.
  const tip = document.querySelector('.tip');
  document.addEventListener('pointermove', (e) => {
    const h = e.target.closest && e.target.closest('.hit');
    if (!h) { tip.hidden = true; return; }
    const [v, when, rest] = tip.children;
    v.textContent = h.dataset.v + ' tokens';
    when.textContent = h.dataset.when;
    rest.textContent = h.dataset.n + ' · ' + h.dataset.c + ' ' + ${JSON.stringify(t.report.withCacheShort)};
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + 'px';
    tip.style.top = (e.clientY - tip.offsetHeight - 10) + 'px';
  });
</script></body></html>`;
}

function html(r, found, opts) {
  return htmlViews([{ key: 'all', label: '', r, found }], opts);
}


// --- Text ---

function text(r, found, { scope, paths }) {
  const top5 = r.sessions.slice(0, 5).reduce((s, x) => s + x.tokens, 0);
  const out = [`\n${t.report.history}: ${r.dir} (${r.backend})${scope ? ` · ${t.report.projectLower} ${scope}` : ''}`,
    t.report.summary(r.conversations, r.steps, fmt(r.tokens))];
  if (r.period) out.push(periodLine(r));
  if (r.olderSkipped) out.push(`(${t.report.olderSkipped(r.olderSkipped)})`);
  if (!r.conversations) return out.join('\n') + '\n';
  const u = r.usage;
  if (u.conversations) {
    out.push(t.report.realUsage(fmt(billed(u)), fmt(u.input), fmt(u.output), fmt(withCache(u)), u.calls)
      + (u.conversations < r.conversations ? t.report.noLog(r.conversations - u.conversations) : ''));
    const top = r.sessions.filter((s) => s.usage).slice(0, 5);
    out.push(t.report.topSessions(top.length));
    for (const s of top) {
      out.push(`    ${fmt(billed(s.usage)).padStart(10)}  ${pct(billed(s.usage), billed(u)).padStart(4)}  ${t.report.sessionLine(s.id.slice(0, 8), s.usage.calls, s.usage.errors, fmt(withCache(s.usage)), sessionModel(s), when(s.start, s.end))}`);
    }
  }
  out.push(t.report.top5(pct(top5, r.tokens), r.reads, r.rereads, pct(r.rereads, r.reads)));
  const models = r.models.filter((m) => m.model);
  if (models.length) {
    const total = r.models.reduce((s, m) => s + m.input + m.output, 0);
    out.push('', t.report.modelsText);
    for (const m of models) {
      const tok = m.input + m.output;
      out.push(`  ${t.report.modelLine(m.model, effortLabel(m.effort), m.calls, fmt(tok), pct(tok, total), m.known ? fmt(tok / m.known) : '–')}`);
    }
  }
  for (const f of found) {
    out.push('', `${f.level === 'warn' ? '⚠' : '•'} ${f.title}${f.tokens ? `  (~${fmt(f.tokens)} tokens, ${pct(f.tokens, r.tokens)})` : ''}`,
      `  ${f.why}`, `  → ${f.suggestion}`);
    // Only file and folder labels are paths; commands and session ids are always shown.
    const hasPaths = ['rereads', 'non-source', 'cross-session'].includes(f.id);
    for (const it of f.items) {
      out.push(`    ${(it.tokens ? `${it.exact ? '' : '~'}${fmt(it.tokens)}` : '').padStart(10)}  ${paths || !hasPaths ? it.label : t.report.pathHidden}  ${it.detail || ''}`);
      if (paths) for (const x of it.fixes.filter((x) => !x.applied)) out.push(`${' '.repeat(16)}${x.title}: ${x.text.split('\n').join(' ')}  →  ${x.file}`);
    }
  }
  out.push('', t.report.byKindText);
  for (const k of r.kinds.slice(0, 10)) out.push(`  ${`~${fmt(k.tokens)}`.padStart(10)}  ${String(k.calls).padStart(5)}×  ${kindLabel(k.key)}`);
  out.push('', t.report.textFooter, '');
  return out.join('\n');
}

module.exports = { html, htmlViews, text };
