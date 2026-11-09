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
  const detail = it.targets?.length ? `${it.detail}: ${it.targets.join(', ')}` : it.detail;
  return `<li><div class="row"><div class="what"><span class="label">${esc(it.label)}</span><span class="detail">${esc(detail)}</span></div>
    <span class="num">${it.tokens ? `${it.exact ? '' : '~'}${fmt(it.tokens)}` : ''}</span></div>${extra}</li>`;
}

// Share of the 5 top conversations: of real usage (the same ranking the report lists) when the history has it,
// else of the estimated context.
function topShare(r) {
  if (r.usage.conversations) {
    const top = r.threads.filter((s) => s.usage).slice(0, 5);
    return { pct: pct(top.reduce((a, s) => a + billed(s.usage), 0), billed(r.usage)), real: true };
  }
  return { pct: pct(r.sessions.slice(0, 5).reduce((a, x) => a + x.tokens, 0), r.tokens), real: false };
}

// A finding's share: of real usage when its figure is real (`exact`) or estimated from it (`ofReal`),
// else of the estimated context.
const share = (f, r) => (f.exact || f.ofReal ? billed(r.usage) : r.tokens);

function finding(f, r) {
  return `<section class="finding ${f.level}">
    <h3>${esc(f.title)}${f.tokens ? ` <span class="tok">${f.exact ? '' : '~'}${fmt(f.tokens)} tokens · ${pct(f.tokens, share(f, r))}</span>` : ''}</h3>
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

// Origins are only told apart when the history mixes several (CLI and editor).
const mixed = (r) => r.origins.length > 1;
const originName = (o) => t.report.origin[o] || t.report.origin.other;

// " · incl. 2 subagents (9,130)": a conversation's figures include the subagents it started.
const subagentsNote = (s) => {
  if (!s.subagents?.length) return '';
  return t.report.subagentsNote(s.subagents.length, fmt(s.subagents.reduce((a, c) => a + (c.usage ? billed(c.usage) : 0), 0)), s.subagents.map((c) => c.id.slice(0, 8)).join(', '));
};

function sessionsTable(r) {
  const rows = r.threads.filter((s) => s.usage).slice(0, 15);
  if (!rows.length) return '';
  const max = Math.max(...rows.map((s) => billed(s.usage)), 1);
  const cols = mixed(r) ? t.report.sessionCols : t.report.sessionCols.filter((_, i) => i !== 2);
  return `<h3>${t.report.sessionsTitle}</h3><div class="scroll"><table><thead><tr>${cols.map((c, i) => `<th${i > cols.length - 6 ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>
  ${rows.map((s) => `<tr><td><div class="bar" style="--w:${((100 * billed(s.usage)) / max).toFixed(1)}%"></div><span>${esc(s.title || s.id.slice(0, 8))}</span>${s.title ? `<span class="detail">${esc(s.id.slice(0, 8))}</span>` : ''}${s.subagents?.length ? `<span class="detail">${esc(subagentsNote(s).replace(/^ · /, ''))}</span>` : ''}</td><td class="when">${esc(when(s.start, s.end))}</td>${mixed(r) ? `<td class="when">${esc(originName(s.origin))}</td>` : ''}<td>${esc(sessionModel(s))}</td>
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

// Conversations and real usage per origin (CLI, editor / VS Code), when the history mixes them.
function originsTable(r) {
  if (!mixed(r)) return '';
  const total = billed(r.usage);
  const max = Math.max(...r.origins.map(billed), 1);
  return `<section class="origins"><h2>${t.report.originsTitle}</h2><p class="hint">${t.report.originsHint}</p>
    <div class="scroll"><table><thead><tr>${t.report.originCols.map((c, i) => `<th${i ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>
    ${r.origins.map((o) => `<tr><td><div class="bar" style="--w:${((100 * billed(o)) / max).toFixed(1)}%"></div><span>${esc(originName(o.origin))}</span></td>
      <td class="num">${o.conversations}</td><td class="num">${fmt(o.calls)}</td><td class="num">${fmt(billed(o))}</td><td class="num">${pct(billed(o), total)}</td>
      <td class="num">${o.calls ? fmt(billed(o) / o.calls) : '–'}</td><td class="num">${fmt(withCache(o))}</td></tr>`).join('')}
    </tbody></table></div></section>`;
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

// Mean tokens per call: unlike the total, it doesn't follow how much the agent was used that day.
const perCall = (x) => (x.calls ? x.billed / x.calls : 0);

function chart(r) {
  const b = buckets(r);
  if (!b) return '';
  const title = b.weekly ? t.report.chartTitleWeek : t.report.chartTitleDay;
  const rows = b.rows.filter((x) => x.calls);
  return `<section class="chart">
    <h2>${title}</h2>
    <div class="mode" role="group" aria-label="${esc(t.report.chartModeLabel)}">
      <button type="button" data-mode="total" aria-pressed="true">${t.report.chartModeTotal}</button><button type="button" data-mode="call" aria-pressed="false">${t.report.chartModeCall}</button></div>
    <p class="hint" data-mode="total">${t.report.chartHint}</p>
    <p class="hint" data-mode="call" hidden>${t.report.chartHintCall}</p>
    <div class="plot" data-mode="total">${plot(b, (x) => x.billed, (x) => `${fmt(x.billed)} tokens`, (x) => `${fmt(x.billed + x.cache)} ${t.report.withCacheShort}`, title)}</div>
    <div class="plot" data-mode="call" hidden>${plot(b, perCall, (x) => t.report.perCallTip(fmt(perCall(x))), (x) => `${fmt(perCall(x) + x.cache / x.calls)} ${t.report.withCacheShort}`, `${title} · ${t.report.chartModeCall}`)}</div>
    <details><summary>${t.report.chartTable}</summary><div class="scroll"><table><thead><tr>${(b.weekly ? t.report.chartColsWeek : t.report.chartCols).map((c, i) => `<th${i ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((x) => `<tr><td>${esc(shortDate(x.date, true))}</td><td class="num">${fmt(x.billed)}</td><td class="num">${fmt(x.billed + x.cache)}</td><td class="num">${x.calls}</td><td class="num">${fmt(perCall(x))}</td></tr>`).join('')}
    </tbody></table></div></details>
  </section>`;
}

// One column chart of `value` per bucket; `tip` and `cache` are the tooltip's headline and cache line.
function plot(b, value, tip, cache, label) {
  const W = 900, H = 240, m = { l: 56, r: 8, t: 12, b: 28 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const top = niceMax(Math.max(...b.rows.map(value)));
  const band = pw / b.rows.length;
  const bw = Math.max(1, Math.min(24, band - 2));
  const y = (v) => m.t + ph - (v / top) * ph;
  const when = (x) => (b.weekly ? t.report.weekOf(shortDate(x.date, true)) : shortDate(x.date, true));

  const grid = [0, top / 2, top].map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
    <text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${esc(compact(v))}</text>`).join('');
  // Rounded data end (4px), square at the baseline.
  const bars = b.rows.map((x, i) => {
    const h = (value(x) / top) * ph;
    if (h <= 0) return '';
    const x0 = m.l + i * band + (band - bw) / 2, y0 = m.t + ph - h, rr = Math.min(4, h, bw / 2);
    return `<path class="col" d="M${x0},${m.t + ph}V${y0 + rr}Q${x0},${y0} ${x0 + rr},${y0}H${x0 + bw - rr}Q${x0 + bw},${y0} ${x0 + bw},${y0 + rr}V${m.t + ph}Z"/>`;
  }).join('');
  // Hit targets: the whole band, so a 2px column is as easy to hover as a 24px one.
  const hits = b.rows.map((x, i) => `<rect class="hit" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ph}"
    data-when="${esc(when(x))}" data-v="${esc(x.calls ? tip(x) : t.report.noActivity)}" data-c="${esc(x.calls ? cache(x) : '')}" data-n="${esc(x.calls ? t.report.chartCalls(x.calls) : '')}"/>`).join('');
  const every = Math.max(1, Math.ceil(b.rows.length / 6));
  // A date every few columns, plus the last one when it isn't crowded by the previous label.
  const last = b.rows.length - 1;
  const ticks = b.rows.map((x, i) => (i % every === 0 || (i === last && last % every >= every / 2)) && `<text x="${i === 0 && band < 40 ? m.l : i === last && band < 40 ? W - m.r : m.l + i * band + band / 2}" y="${H - 8}" text-anchor="${i === 0 && band < 40 ? 'start' : i === last && band < 40 ? 'end' : 'middle'}" class="axis">${esc(shortDate(x.date))}</text>`).filter(Boolean).join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${bars}${ticks}${hits}</svg>`;
}

// --- Page ---

function body(r, found, scope) {
  const top5 = topShare(r);
  const u = r.usage;
  const meta = `<p class="meta">${t.report.convs(r.conversations)}${r.period ? ` · ${esc(periodLine(r))}` : ''}</p>`;
  if (!r.conversations) {
    return `${meta}<p>${t.report.noConversations(scope && esc(scope), esc(r.dir))}${r.olderSkipped ? ` ${esc(t.report.olderSkipped(r.olderSkipped))}.` : ''}</p>`;
  }
  return `${meta}<div class="tiles">
      ${u.conversations ? `<div><b>${fmt(billed(u))}</b><span>${t.report.tileReal}</span></div>
      <div><b>${fmt(withCache(u))}</b><span>${t.report.tileCache(u.calls)}</span></div>` : ''}
      <div><b>${fmt(r.tokens)}</b><span>${t.report.tileContext}</span></div>
      <div><b>${top5.pct}</b><span>${t.report.tileTop5(top5.real)}</span></div>
      <div><b>${r.reads}</b><span>${t.report.tileReads}</span></div>
      <div><b>${pct(r.rereads, r.reads)}</b><span>${t.report.tileRereads}</span></div>
    </div>
    ${chart(r)}
    ${originsTable(r)}
    ${modelsTable(r)}
    <h2>${t.report.happening}</h2>
    <p class="hint">${t.report.happeningHint}</p>
    ${found.length ? found.map((f) => finding(f, r)).join('') : `<p>${t.report.nothing}</p>`}
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
  /* Material 3 components with a tonal palette built from the logo's teal (#0f766e). Fonts are used only when
     installed locally, so the page still makes no network requests. */
  :root { --bg: #f6f8f7; --surface: #fff; --fg: #191c1b; --muted: #56605d; --line: #d5dcd9; --line-soft: #e7ecea;
    --accent: #0f766e; --accent-soft: #d7efe9; --hover: rgb(25 28 27 / .05);
    --warn: #a15c07; --warn-soft: #fbefdc; --ok: #0f766e; --ok-soft: #d7efe9;
    --code: #eef2f0; --bar: #0f766e; --series: #14857b; --shadow: 0 1px 2px rgb(25 28 27 / .25), 0 1px 3px 1px rgb(25 28 27 / .12); color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161a19; --surface: #1f2423; --fg: #e0e4e2; --muted: #a0aba7; --line: #3a4341; --line-soft: #2c3331;
    --accent: #7fd6c9; --accent-soft: #1c3d39; --hover: rgb(224 228 226 / .07);
    --warn: #f2c07a; --warn-soft: #3b2f1c; --ok: #7fd6c9; --ok-soft: #1c3d39;
    --code: #272d2c; --bar: #7fd6c9; --series: #4fb3a6; --shadow: 0 1px 3px rgb(0 0 0 / .5), 0 4px 8px 3px rgb(0 0 0 / .25); color-scheme: dark; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 "Google Sans Text", "Google Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  h1, h2, h3, .tiles b, .appbar { font-family: "Google Sans", "Google Sans Display", "Product Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .appbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 24px; background: var(--surface); border-bottom: 1px solid var(--line); }
  .appbar svg { flex: none; } .appbar .name { font-size: 22px; color: var(--muted); } .appbar .name b { font-weight: 500; color: var(--fg); }
  main { max-width: 1040px; margin: 0 auto; padding: 28px 16px 48px; }
  h1 { font-size: 28px; font-weight: 400; margin: 0 0 4px; line-height: 1.3; } h2 { font-size: 22px; font-weight: 400; margin: 36px 0 6px; display: inline-block; }
  h3 { font-size: 16px; font-weight: 500; margin: 0 0 6px; }
  .meta, .hint, .detail, .tok, .where { color: var(--muted); } .tok { font-weight: 400; font-size: 14px; }
  code, pre { font-family: "Google Sans Mono", "Roboto Mono", ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 13px; }
  code { background: var(--code); padding: 1px 6px; border-radius: 4px; overflow-wrap: anywhere; }
  button { font-family: inherit; -webkit-tap-highlight-color: transparent; }
  /* Filter chips */
  .filter { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 20px 0 4px; }
  .filter span { color: var(--muted); font-size: 14px; margin-right: 4px; }
  .filter button { display: inline-flex; align-items: center; gap: 6px; height: 32px; font-size: 14px; font-weight: 500; color: var(--muted); background: var(--surface);
    border: 1px solid var(--line); border-radius: 8px; padding: 0 16px; cursor: pointer; transition: background .15s, color .15s; }
  .filter button:hover { background: var(--hover); color: var(--fg); }
  .filter button[aria-pressed="true"] { background: var(--accent-soft); border-color: transparent; color: var(--accent); padding-left: 10px; }
  .filter button[aria-pressed="true"]::before { content: "✓"; }
  .filter button:focus-visible, .mode button:focus-visible, .copy:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* Segmented button */
  .mode { display: inline-flex; margin: 0 0 0 16px; vertical-align: 4px; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
  .mode button { display: inline-flex; align-items: center; gap: 6px; height: 32px; font-size: 13px; font-weight: 500; color: var(--fg); background: transparent; border: 0; padding: 0 14px; cursor: pointer; }
  .mode button + button { border-left: 1px solid var(--line); }
  .mode button:hover { background: var(--hover); }
  .mode button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
  .mode button[aria-pressed="true"]::before { content: "✓"; }
  /* KPI cards: the two real-usage figures come first and are filled with the accent tone */
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0 24px; }
  .tiles div { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  .tiles div:first-child { background: var(--accent-soft); border-color: transparent; } .tiles div:first-child b { color: var(--accent); }
  .tiles b { display: block; font-size: 28px; font-weight: 400; line-height: 1.25; font-variant-numeric: tabular-nums; } .tiles span { color: var(--muted); font-size: 13px; }
  .chart h2 { margin-top: 8px; } .models .hint { margin-top: 0; } .chart .hint { margin-top: 0; }
  .plot { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 12px 4px; }
  .plot svg { display: block; width: 100%; height: auto; }
  .grid { stroke: var(--line-soft); stroke-width: 1; } .axis { fill: var(--muted); font: 12px Roboto, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  .col { fill: var(--series); } .hit { fill: transparent; cursor: default; } .hit:hover { fill: var(--accent); fill-opacity: .08; }
  .tip { position: fixed; pointer-events: none; background: var(--surface); color: var(--fg); border-radius: 8px;
    padding: 8px 12px; font-size: 12px; box-shadow: var(--shadow); z-index: 10; }
  .tip b { display: block; font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; } .tip span { display: block; color: var(--muted); }
  /* Findings: outlined cards with a status icon */
  .finding { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px 16px 60px; margin: 12px 0; }
  .finding::before { content: "i"; position: absolute; left: 18px; top: 16px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
    background: var(--accent-soft); color: var(--accent); font: italic 700 14px/1 Georgia, serif; }
  .finding.warn::before { content: "!"; background: var(--warn-soft); color: var(--warn); font: 700 15px/1 Roboto, system-ui, sans-serif; }
  .finding p { margin: 4px 0; }
  .items { list-style: none; margin: 12px 0 0; padding: 0; }
  .items > li { border-top: 1px solid var(--line-soft); padding: 10px 0; }
  .row { display: flex; gap: 12px; align-items: baseline; justify-content: space-between; }
  .what { min-width: 0; } .label { display: block; word-break: break-all; } .detail { display: block; font-size: 13px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  details > summary { cursor: pointer; color: var(--accent); font-size: 14px; font-weight: 500; margin: 6px 0 0 -8px; width: fit-content; border-radius: 999px; padding: 4px 12px 4px 8px; }
  details > summary:hover { background: var(--accent-soft); }
  .fix { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 8px 0; }
  .fix.done { opacity: .6; } .fix-head { display: flex; gap: 8px; align-items: center; }
  .pill { font-size: 12px; font-weight: 500; background: var(--ok-soft); color: var(--ok); border-radius: 999px; padding: 2px 10px; }
  .where, .hint { font-size: 13px; margin: 4px 0; }
  .code { position: relative; background: var(--code); border-radius: 8px; }
  .code pre { margin: 0; padding: 12px 84px 12px 14px; overflow-x: auto; white-space: pre; }
  .copy { position: absolute; top: 6px; right: 6px; font-size: 13px; font-weight: 500; color: var(--accent); background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 4px 14px; cursor: pointer; }
  .copy:hover { background: var(--accent-soft); }
  /* Data tables */
  .scroll { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; margin: 8px 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; color: var(--muted); font-size: 12px; font-weight: 500; white-space: nowrap; } th, td { padding: 10px 12px; border-bottom: 1px solid var(--line-soft); }
  tbody tr:last-child td { border-bottom: 0; } tbody tr:hover { background: var(--hover); }
  td:first-child { position: relative; overflow-wrap: anywhere; } td.when { white-space: nowrap; }
  .bar { position: absolute; inset: 6px auto 6px 4px; width: var(--w); background: var(--bar); opacity: .14; border-radius: 4px; } td span { position: relative; }
  .detail-all > summary { color: var(--fg); } .detail-all > summary:hover { background: none; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
  @media (max-width: 600px) { .appbar { padding: 0 16px; height: 56px; } .mode { display: flex; width: fit-content; margin: 8px 0 0; } .finding { padding-left: 52px; } .finding::before { left: 14px; } }
</style></head><body><header class="appbar"><svg width="32" height="32" viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" rx="56" fill="#0f766e"/><rect x="56" y="72" width="36" height="112" rx="8" fill="#fff"/><rect x="110" y="108" width="36" height="76" rx="8" fill="#fff" fill-opacity=".8"/><rect x="164" y="140" width="36" height="44" rx="8" fill="#fff" fill-opacity=".6"/><rect x="48" y="196" width="160" height="10" rx="5" fill="#fff"/></svg><span class="name"><b>agy</b>-insights</span></header>
<main>
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
    // Chart mode: the same in every period, so switching periods keeps it.
    const m = e.target.closest('.mode button');
    if (m) {
      for (const b of document.querySelectorAll('.mode button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m.dataset.mode));
      for (const p of document.querySelectorAll('.chart [data-mode]:not(button)')) p.hidden = p.dataset.mode !== m.dataset.mode;
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
    v.textContent = h.dataset.v;
    when.textContent = h.dataset.when;
    rest.textContent = h.dataset.c ? h.dataset.n + ' · ' + h.dataset.c : h.dataset.n;
    rest.hidden = !rest.textContent;
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

// With --session: how the context grew call by call, and what entered it, largest first. Files show only
// their name unless --paths; commands are always shown, as in the findings.
function sessionText(s, paths) {
  const out = ['', t.report.insideSession(s.id.slice(0, 8) + (s.parent ? t.findings.subagentOf(s.parent.slice(0, 8)) : ''))];
  const inputs = (s.usage?.perCall || []).filter((c) => c.metered).map((c) => c.input);
  if (inputs.length) {
    const shown = inputs.length > 20 ? [...inputs.slice(0, 10).map(fmt), '…', ...inputs.slice(-9).map(fmt)] : inputs.map(fmt);
    out.push(`  ${t.report.perCallInput}: ${shown.join(' → ')}`);
    // The first call carries little more than what every call starts with (instructions, tools, rules):
    // that times the calls is the session's base; the rest is what the conversation piled up.
    const total = inputs.reduce((a, b) => a + b, 0);
    const base = Math.min(inputs[0] * inputs.length, total);
    if (inputs.length > 1) out.push(`  ${t.report.baseVsGrowth(fmt(inputs[0]), inputs.length, fmt(base), pct(base, total), fmt(total - base), pct(total - base, total))}`);
  }
  out.push(`  ${t.report.contentsText}`);
  for (const c of s.contents.slice(0, 10)) {
    const target = c.target && c.name !== 'run_command' && !paths ? c.target.split(/[\\/]/).pop() : c.target;
    out.push(`    ${`~${fmt(c.tokens)}`.padStart(10)}  ${String(c.calls).padStart(4)}×  ${c.name}${target ? `  ${target}` : ''}${c.rereads ? `  (${t.report.rereadsCount(c.rereads)})` : ''}`);
  }
  if (s.failures.length) {
    out.push(`  ${t.report.failuresText}`);
    for (const x of s.failures) {
      const shown = x.tool === 'run_command' || paths ? x.targets : x.targets.map((p) => p.split(/[\\/]/).pop());
      out.push(`    ${String(x.count).padStart(4)}×  ${x.tool || '?'} · ${t.findings.failureKind[x.kind]}${shown.length ? `: ${shown.join(', ')}` : ''}`);
    }
  }
  if (s.polled.length) {
    out.push(`  ${t.report.polledText}`);
    for (const x of s.polled) out.push(`    ${String(x.reads).padStart(4)}×  ${paths ? x.file : x.file.split(/[\\/]/).pop()}${/\/brain\/[0-9a-f-]{36}\//i.test(x.file) ? `  (${t.findings.subagentLog})` : ''}`);
  }
  return out;
}

function text(r, found, { scope, paths, session }) {
  const top5 = topShare(r);
  const out = [`\n${t.report.history}: ${r.dir} (${r.backend})${scope ? ` · ${t.report.projectLower} ${scope}` : ''}`,
    t.report.summary(r.conversations, r.steps, fmt(r.tokens))];
  if (r.period) out.push(periodLine(r));
  if (r.olderSkipped) out.push(`(${t.report.olderSkipped(r.olderSkipped)})`);
  if (!r.conversations) return out.join('\n') + '\n';
  const u = r.usage;
  if (u.conversations) {
    out.push(t.report.realUsage(fmt(billed(u)), fmt(u.input), fmt(u.output), fmt(withCache(u)), u.calls)
      + (u.conversations < r.conversations ? t.report.noLog(r.conversations - u.conversations) : ''));
    const top = r.threads.filter((s) => s.usage).slice(0, 5);
    out.push(t.report.topSessions(top.length));
    for (const s of top) {
      out.push(`    ${fmt(billed(s.usage)).padStart(10)}  ${pct(billed(s.usage), billed(u)).padStart(4)}  ${t.report.sessionLine(s.id.slice(0, 8), s.usage.calls, s.usage.errors, fmt(withCache(s.usage)), sessionModel(s), [when(s.start, s.end), mixed(r) && originName(s.origin)].filter(Boolean).join(' · '), s.title)}${subagentsNote(s)}`);
    }
    if (mixed(r)) {
      out.push(t.report.originsText);
      for (const o of r.origins) out.push(`    ${fmt(billed(o)).padStart(10)}  ${pct(billed(o), billed(u)).padStart(4)}  ${originName(o.origin)} (${t.report.convs(o.conversations)})`);
    }
  }
  if (!session) out.push(t.report.top5(top5.pct, top5.real, r.reads, r.rereads, pct(r.rereads, r.reads)));
  const models = r.models.filter((m) => m.model);
  if (models.length) {
    const total = r.models.reduce((s, m) => s + m.input + m.output, 0);
    out.push('', t.report.modelsText);
    for (const m of models) {
      const tok = m.input + m.output;
      out.push(`  ${t.report.modelLine(m.model, effortLabel(m.effort), m.calls, fmt(tok), pct(tok, total), m.known ? fmt(tok / m.known) : '–')}`);
    }
  }
  if (session) for (const s of r.sessions) out.push(...sessionText(s, paths));
  for (const f of found) {
    out.push('', `${f.level === 'warn' ? '⚠' : '•'} ${f.title}${f.tokens ? `  (${f.exact ? '' : '~'}${fmt(f.tokens)} tokens, ${pct(f.tokens, share(f, r))})` : ''}`,
      `  ${f.why}`, `  → ${f.suggestion}`);
    // Only file and folder labels are paths; commands and session ids are always shown.
    const hasPaths = ['rereads', 'non-source', 'cross-session', 'polling'].includes(f.id);
    for (const it of f.items) {
      const targets = it.targets?.length ? `: ${paths || !it.pathTargets ? it.targets.join(', ') : t.report.pathHidden}` : '';
      out.push(`    ${(it.tokens ? `${it.exact ? '' : '~'}${fmt(it.tokens)}` : '').padStart(10)}  ${paths || !hasPaths ? it.label : t.report.pathHidden}  ${it.detail || ''}${targets}`);
      if (paths) for (const x of it.fixes.filter((x) => !x.applied)) out.push(`${' '.repeat(16)}${x.title}: ${x.text.split('\n').join(' ')}  →  ${x.file}`);
    }
  }
  out.push('', t.report.byKindText);
  for (const k of r.kinds.slice(0, 10)) out.push(`  ${`~${fmt(k.tokens)}`.padStart(10)}  ${String(k.calls).padStart(5)}×  ${kindLabel(k.key)}`);
  out.push('', t.report.textFooter, '');
  return out.join('\n');
}

module.exports = { html, htmlViews, text };
