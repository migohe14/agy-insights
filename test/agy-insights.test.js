const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { analyze } = require('../lib/history');
const { findings } = require('../lib/findings');
const report = require('../lib/report');
const { buildMap, START, END } = require('../lib/map');
const i18n = require('../lib/i18n');
const { step, userStep, writeConversation, writeTranscript, acmeHistory, ACME } = require('./fake-history');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-insights-test-'));
const history = path.join(tmp, 'history');
const hashes = (dir) => fs.readdirSync(dir).sort().map((f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, f))).digest('hex'));
const byId = (found, id) => found.find((f) => f.id === id);

before(() => { i18n.setLang('en'); return acmeHistory(history); });
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

test('reads every conversation, or only the ones of a project', async () => {
  assert.equal((await analyze({ dir: history })).conversations, 4);
  const r = await analyze({ dir: history, workspaces: [ACME] });
  assert.equal(r.conversations, 3);
  assert.equal(r.reads, 37);
  assert.equal(r.rereads, 1);
});

test('detects the five kinds of finding', async () => {
  const r = await analyze({ dir: history, workspaces: [ACME] });
  const ids = findings(r).map((f) => f.id);
  for (const id of ['rereads', 'non-source', 'cross-session', 'heavy-commands', 'long-sessions']) assert.ok(ids.includes(id), id);
});

test('proposes the official permission rule with the path as the OS writes it', async () => {
  const r = await analyze({ dir: history, workspaces: [ACME] });
  const obj = byId(findings(r), 'non-source').items[0];
  assert.match(obj.label, /^Acme Portal › src\/03-Infra\/obj\/Debug\/net8\.0\/$/);
  const deny = obj.fixes.find((f) => f.how === 'deny');
  assert.equal(deny.text, JSON.stringify('read_file(C:\\dev\\Acme Portal\\src\\03-Infra\\obj\\Debug\\net8.0)'));
  assert.ok(obj.fixes.some((f) => f.how === 'ignore' && f.text === 'src/03-Infra/obj/Debug/net8.0/'));
});

test('never proposes excluding source code, even if it is read in many sessions', async () => {
  const r = await analyze({ dir: history, workspaces: [ACME] });
  const svc = byId(findings(r), 'cross-session').items.find((i) => i.label.endsWith('PedidosService.cs'));
  assert.ok(svc);
  assert.deepEqual(svc.fixes, []);
});

test('counts a call once although agy stores it in two steps', async () => {
  const dir = path.join(tmp, 'history-once');
  await writeConversation(dir, '0000000c-0000-4000-8000-000000000000', [
    userStep('read the service'), step('view_file', { AbsolutePath: `${ACME}\\src\\Servicio.cs` }, 5000),
  ]);
  const r = await analyze({ dir });
  assert.equal(r.reads, 1);
  assert.equal(r.rereads, 0);
  assert.equal(r.tools[0].calls, 1);
});

test('adds up the real usage from the transcripts, subagents included, and ranks sessions by it', async () => {
  const dir = path.join(tmp, 'usage', 'conversations');
  const main = '0000000d-0000-4000-8000-000000000000', sub = '0000000e-0000-4000-8000-000000000000', old = '0000000f-0000-4000-8000-000000000000';
  for (const id of [main, sub, old]) await writeConversation(dir, id, [userStep('x'), step('view_file', { AbsolutePath: `${ACME}\\a.cs` }, 100)]);
  writeTranscript(dir, main, [[7000, 0, 200], [4000, 3600, 100]]);
  writeTranscript(dir, sub, [[30000, 90000, 5000], [20000, 120000, 3000]], 4);
  const r = await analyze({ dir });
  assert.deepEqual(r.usage, { conversations: 2, calls: 4, input: 61000, cache: 213600, output: 8300, errors: 4 });
  assert.equal(r.sessions[0].id, sub);
  assert.equal(r.sessions.find((s) => s.id === old).usage, null);
  const out = report.text(r, findings(r), {});
  assert.match(out, /Real usage: 69,300 tokens .* 282,900 including cache, in 4 model calls/);
  assert.match(out, /\(1 conversation without a log\)/);
  assert.match(report.html(r, findings(r), {}), /Sessions \(real usage\)/);
});

test('leaves the history untouched', async () => {
  const before = hashes(history);
  await analyze({ dir: history });
  assert.deepEqual(hashes(history), before);
});

test('finds the project of a file through its .git folder, and does not write in it', async () => {
  const project = path.join(tmp, 'Tienda');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(path.join(project, 'dist'), { recursive: true });
  const dir = path.join(tmp, 'history-git');
  await writeConversation(dir, '00000009-0000-4000-8000-000000000000', [
    userStep('look at the bundle'),
    step('view_file', { AbsolutePath: path.join(project, 'dist', 'bundle.js') }, 40000),
  ]);
  const r = await analyze({ dir });
  assert.equal(r.projects[0].project, 'Tienda');
  const item = byId(findings(r), 'non-source').items[0];
  assert.equal(item.label, 'Tienda › dist/');
  assert.equal(item.fixes.find((f) => f.how === 'ignore').file, path.join(project, '.antigravityignore'));
  assert.deepEqual(fs.readdirSync(project).sort(), ['.git', 'dist']);
});

test('warns when the history format is not recognised', async () => {
  const dir = path.join(tmp, 'history-unknown');
  await writeConversation(dir, '0000000a-0000-4000-8000-000000000000', Array.from({ length: 60 }, (_, i) => userStep(`paso ${i}`)));
  const r = await analyze({ dir });
  assert.equal(r.formatUnrecognized, true);
  assert.equal(findings(r)[0].id, 'format');
});

test('escapes paths in the HTML report', async () => {
  const dir = path.join(tmp, 'history-html');
  await writeConversation(dir, '0000000b-0000-4000-8000-000000000000', [
    userStep('x'), step('view_file', { AbsolutePath: 'C:\\dev\\<script>alert(1)<\\script>\\obj\\a.cs' }, 9000),
  ]);
  const r = await analyze({ dir });
  const html = report.html(r, findings(r), {});
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('&lt;script&gt;alert(1)'));
});

test('builds a short project map with large files and generated folders, without writing', () => {
  const project = path.join(tmp, 'Mapa');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true }); fs.writeFileSync(path.join(project, rel), text); };
  write('src/Core/Orders/Service.cs', 'x\n'.repeat(900));
  write('src/Core/Invoices/Invoice.cs', 'x\n'.repeat(10));
  write('src/App/Handler.cs', 'x\n');
  write('src/Infra/obj/Debug/Gen.g.cs', 'x\n'.repeat(5000));
  write('src/Data/Migrations/Init.cs', 'x\n'.repeat(3000));
  const before = fs.readdirSync(project).sort();
  const m = buildMap(project);
  assert.match(m.text, /- src\/Core\/: Invoices, Orders \(2 files\)/);
  assert.match(m.text, /- src\/Core\/Orders\/Service\.cs \(~900 lines\)/);
  assert.ok(!m.text.includes('Gen.g.cs') && !m.text.includes('Init.cs'));
  assert.match(m.text, /Don't read .*src\/Data\/Migrations\/.*src\/Infra\/obj\//);
  assert.ok(m.block.startsWith(START) && m.block.endsWith(END));
  assert.deepEqual(fs.readdirSync(project).sort(), before);
});

test('the command prints a text report and changes nothing', () => {
  const before = hashes(history);
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'agy-insights.js'), '--dir', history, '--text', '--paths', '--lang', 'en'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /4 conversations/);
  assert.match(res.stdout, /Deny reading it/);
  assert.deepEqual(hashes(history), before);
});

test('speaks Spanish with --lang es, numbers included', async () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'agy-insights.js'), '--dir', history, '--text', '--paths', '--lang', 'es'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /4 conversaciones/);
  assert.match(res.stdout, /Denegar la lectura/);
  assert.match(res.stdout, /código generado \/ migraciones/);
  assert.match(res.stdout, /~\d{1,3}\.\d{3}/);
  i18n.setLang('es');
  try {
    const r = await analyze({ dir: history, workspaces: [ACME] });
    const html = report.html(r, findings(r), {});
    assert.match(html, /<html lang="es">/);
    assert.match(html, /Qué está pasando/);
  } finally {
    i18n.setLang('en');
  }
});

test('picks the language from the system locale, English by default', () => {
  assert.equal(i18n.detect({ LANG: 'es_ES.UTF-8' }), 'es');
  assert.equal(i18n.detect({ LC_ALL: 'es-MX' }), 'es');
  assert.equal(i18n.detect({ LANG: 'en_US.UTF-8' }), 'en');
  assert.equal(i18n.detect({ LANG: 'fr_FR' }), 'en');
  assert.equal(i18n.setLang('fr'), false);
});

test('rejects an unsupported language', () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'agy-insights.js'), '--lang', 'fr', '--help'], { encoding: 'utf8', env: { ...process.env, LANG: 'en_US' } });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Unsupported language: fr/);
});

test('both languages define the same messages', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(i18n.LANGS.es), keys(i18n.LANGS.en));
});

test('dates each conversation and filters by --since and --days', async () => {
  const dir = path.join(tmp, 'dated', 'conversations');
  const ids = ['00000010-0000-4000-8000-000000000000', '00000011-0000-4000-8000-000000000000', '00000012-0000-4000-8000-000000000000'];
  for (const id of ids) await writeConversation(dir, id, [userStep('x'), step('view_file', { AbsolutePath: `${ACME}\a.cs` }, 100)]);
  // Old one dated by the database's last write; the other two by their transcript's step times.
  const old = new Date(2026, 0, 10, 12);
  fs.utimesSync(path.join(dir, `${ids[0]}.db`), old, old);
  const at = (d) => ({ type: 'PLANNER_RESPONSE', input_tokens: 1, output_tokens: 1, created_at: d.toISOString() });
  for (const [id, days] of [[ids[1], [2, 2]], [ids[2], [40, 39]]]) {
    const logs = path.join(dir, '..', 'brain', id, '.system_generated', 'logs');
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, 'transcript.jsonl'), days.map((d) => JSON.stringify(at(new Date(Date.now() - d * 864e5)))).join('\n'));
  }

  const all = await analyze({ dir });
  assert.equal(all.conversations, 3);
  assert.equal(all.period.from, old.getTime());
  const recent = await analyze({ dir, since: Date.now() - 7 * 864e5 });
  assert.equal(recent.conversations, 1);
  assert.equal(recent.olderSkipped, 2);
  assert.match(report.text(recent, findings(recent), {}), /Period: on .* \(filter: active since /);

  const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'agy-insights.js'), '--dir', dir, '--text', ...args], { encoding: 'utf8' });
  assert.match(cli('--days', '7', '--lang', 'en').stdout, /^1 conversation, \d+ steps/m);
  assert.match(cli('--since', '2026-01-01', '--lang', 'es').stdout, /^3 conversaciones/m);
  assert.match(cli('--since', '2026-02-30', '--lang', 'en').stderr, /Invalid date: 2026-02-30/);
  assert.match(cli('--days', 'x', '--lang', 'es').stderr, /Número de días no válido: x/);
});

test('uses the singular for one call, error or conversation', () => {
  for (const lang of ['en', 'es']) {
    i18n.setLang(lang);
    const line = i18n.t.report.sessionLine('abc', 1, 1, '10');
    assert.doesNotMatch(line, /\b1 (calls|errors|llamadas|errores)\b/);
  }
  i18n.setLang('en');
  assert.equal(i18n.t.done(1, 1, 'x'), '1 conversation analyzed, 1 finding.\nReport: x');
});

test('the HTML report charts real usage per day and switches between periods', async () => {
  const dir = path.join(tmp, 'charted', 'conversations');
  const days = [1, 3, 20];
  for (const [i, d] of days.entries()) {
    const id = `0000002${i}-0000-4000-8000-000000000000`;
    await writeConversation(dir, id, [userStep('x'), step('view_file', { AbsolutePath: `${ACME}\a.cs` }, 100)]);
    const logs = path.join(dir, '..', 'brain', id, '.system_generated', 'logs');
    fs.mkdirSync(logs, { recursive: true });
    const at = new Date(Date.now() - d * 864e5).toISOString();
    fs.writeFileSync(path.join(logs, 'transcript.jsonl'), JSON.stringify({ type: 'PLANNER_RESPONSE', created_at: at, input_tokens: 1000 * (i + 1), cache_read_tokens: 5, output_tokens: 10 }));
  }
  const r = await analyze({ dir });
  assert.deepEqual(r.daily.map((x) => x.input), [3000, 2000, 1000]);
  const week = await analyze({ dir, since: Date.now() - 7 * 864e5 });
  assert.equal(week.daily.length, 2);

  const page = report.htmlViews([
    { key: 'all', label: 'All history', r, found: findings(r) },
    { key: 'd7', label: 'Last 7 days', r: week, found: findings(week) },
  ], {});
  assert.equal((page.match(/class="col"/g) || []).length, 3 + 2);
  assert.match(page, /<button type="button" data-view="d7" aria-pressed="false">Last 7 days<\/button>/);
  assert.match(page, /<div class="view" data-view="d7" hidden>/);
  assert.match(page, /Token usage per day/);
  // A single period has no filter row.
  assert.doesNotMatch(report.html(r, findings(r), {}), /class="filter"/);
});

test('the command writes a report with the period presets', () => {
  const out = path.join(tmp, 'presets.html');
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'agy-insights.js'), '--dir', history, '--out', out, '--no-open', '--lang', 'es'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const page = fs.readFileSync(out, 'utf8');
  for (const label of ['Todo el historial', 'Últimos 90 días', 'Últimos 30 días', 'Últimos 7 días']) assert.ok(page.includes(`>${label}</button>`), label);
});

test('reports the model and effort level of each call, with its real tokens', async () => {
  const dir = path.join(tmp, 'models', 'conversations');
  const a = '00000030-0000-4000-8000-000000000000', b = '00000031-0000-4000-8000-000000000000';
  await writeConversation(dir, a, [userStep('x')], ['Gemini 3.8 Flash (High)', 'Gemini 3.8 Pro (Low)', 'Gemini 3.8 Flash (High)']);
  writeTranscript(dir, a, [[1000, 0, 100], [5000, 0, 500], [2000, 0, 200]]);
  await writeConversation(dir, b, [userStep('x')], 'gemini-3.8-pro-low');
  const r = await analyze({ dir });
  const by = (model, effort) => r.models.find((m) => m.model === model && m.effort === effort);
  assert.deepEqual({ ...by('Gemini 3.8 Flash', 'High'), }, { model: 'Gemini 3.8 Flash', effort: 'High', calls: 2, convs: 1, input: 3000, cache: 0, output: 300, known: 2 });
  // "gemini-3.8-pro-low" (id spelling, no transcript) and "Gemini 3.8 Pro (Low)" are one model.
  assert.deepEqual(by('Gemini 3.8 Pro', 'Low'), { model: 'Gemini 3.8 Pro', effort: 'Low', calls: 2, convs: 2, input: 5000, cache: 0, output: 500, known: 1 });
  assert.equal(r.models.length, 2);
  assert.equal(r.sessions.find((s) => s.id === a).model.model, 'Gemini 3.8 Flash');
  assert.equal(r.sessions.find((s) => s.id === a).models, 2);

  const text = report.text(r, findings(r), {});
  assert.match(text, /Gemini 3\.8 Flash · High {2}2 calls, 3,300 tokens/);
  assert.match(text, /conversation 00000030 · .+ \(Gemini 3\.8 Flash · High \+1 more\)/);
  assert.match(report.html(r, findings(r), {}), /<h2>Models and effort<\/h2>/);
  i18n.setLang('es');
  try {
    assert.match(report.text(r, findings(r), {}), /Gemini 3\.8 Pro · Bajo {2}2 llamadas/);
  } finally {
    i18n.setLang('en');
  }
});

test('ignores model names inside longer text, like the system prompt', () => {
  const { modelOf } = require('../lib/history');
  assert.deepEqual(modelOf(['Prefer Gemini 3 Pro (High) for hard tasks.', 'gemini-3.8-flash-medium']), { model: 'gemini-3.8-flash', effort: 'medium' });
  assert.deepEqual(modelOf(['nothing here']), { model: null, effort: null });
});

test("never reports Antigravity's own brain or skills as generated files", async () => {
  const dir = path.join(tmp, 'history-brain');
  const brain = 'C:\\Users\\ana\\.gemini\\antigravity-cli\\brain\\0d74ebaa';
  await writeConversation(dir, '00000040-0000-4000-8000-000000000000', [
    userStep('x'),
    step('view_file', { AbsolutePath: `${brain}\\.system_generated\\logs\\transcript.log` }, 30000),
    step('view_file', { AbsolutePath: `${brain}\\browser\\out\\page.md` }, 30000),
    step('view_file', { AbsolutePath: 'C:\\Users\\ana\\.gemini\\skills\\pdf\\SKILL.md' }, 9000),
  ]);
  const r = await analyze({ dir });
  assert.deepEqual(r.kinds.map((k) => k.key), ['agent']);
  assert.equal(byId(findings(r), 'non-source'), undefined);
  assert.match(report.text(r, findings(r), {}), /Antigravity's own files \(brain, skills\)/);
});

test('a build/ or bin/ folder kept in git is source code, not build output', async () => {
  const project = path.join(tmp, 'webfront');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true }); fs.writeFileSync(path.join(project, rel), text); };
  write('build/webpack/webpack.config.js', 'module.exports = {};\n');
  write('bin/cli.js', 'console.log(1);\n');
  write('dist/bundle.js', 'x'.repeat(5000));
  write('.gitignore', 'dist/\n');
  const git = (...args) => spawnSync('git', args, { cwd: project, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init');

  const dir = path.join(tmp, 'history-webfront');
  await writeConversation(dir, '00000050-0000-4000-8000-000000000000', [
    userStep('x'),
    step('view_file', { AbsolutePath: path.join(project, 'build', 'webpack', 'webpack.config.js') }, 20000),
    step('view_file', { AbsolutePath: path.join(project, 'bin', 'cli.js') }, 20000),
    step('view_file', { AbsolutePath: path.join(project, 'dist', 'bundle.js') }, 20000),
  ]);
  const r = await analyze({ dir });
  const kindOf = (rel) => r.files.find((f) => f.rel === rel).kind;
  assert.equal(kindOf('build/webpack/webpack.config.js'), 'code .js');
  assert.equal(kindOf('bin/cli.js'), 'code .js');
  assert.equal(kindOf('dist/bundle.js'), 'build');
  const items = byId(findings(r), 'non-source').items;
  assert.deepEqual(items.map((i) => i.label).filter((l) => !l.includes('"')), ['webfront › dist/']);
  // The project-wide pattern still covers dist/, obj/… but not the build/ and bin/ that hold sources here.
  const pattern = items.find((i) => i.label.includes('"'));
  const ignore = pattern.fixes.find((x) => x.how === 'ignore').text.split('\n');
  assert.ok(ignore.includes('dist/') && ignore.includes('obj/'));
  assert.ok(!ignore.includes('build/') && !ignore.includes('bin/'));
  assert.doesNotMatch(pattern.fixes.find((x) => x.how === 'rule').text, /build\/|bin\//);

  const m = buildMap(project);
  assert.doesNotMatch(m.text, /Don't read.*build\//);
  assert.match(m.text, /- build\/: webpack/);
});

test('dates each session in the long sessions finding and the sessions table', async () => {
  const dir = path.join(tmp, 'long-dated', 'conversations');
  const id = '00000060-0000-4000-8000-000000000000';
  await writeConversation(dir, id, [userStep('x'), step('view_file', { AbsolutePath: `${ACME}\a.cs` }, 100)]);
  const logs = path.join(dir, '..', 'brain', id, '.system_generated', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const call = (h, m) => JSON.stringify({ type: 'PLANNER_RESPONSE', created_at: new Date(2026, 9, 27, h, m).toISOString(), input_tokens: 80000, output_tokens: 30000 });
  fs.writeFileSync(path.join(logs, 'transcript.jsonl'), [call(9, 5), call(10, 40)].join('\n'));

  const r = await analyze({ dir });
  const long = byId(findings(r), 'long-sessions').items[0];
  assert.match(long.label, /^conversation 00000060 · Oct 27, 2026, 09:05 AM–10:40 AM$/);
  assert.match(report.html(r, findings(r), {}), /<td class="when">Oct 27, 2026, 09:05 AM–10:40 AM<\/td>/);
  i18n.setLang('es');
  try {
    assert.match(byId(findings(r), 'long-sessions').items[0].label, /^conversación 00000060 · 27 oct 2026, 9:05–10:40$|^conversación 00000060 · 27 oct 2026, 09:05–10:40$/);
  } finally {
    i18n.setLang('en');
  }
  assert.equal(i18n.when(null, null), '');
});

test('takes the model from the transcript when gen_metadata does not match the calls', async () => {
  const dir = path.join(tmp, 'models-mismatch', 'conversations');
  const id = '00000070-0000-4000-8000-000000000000';
  // Two gen_metadata rows for four calls: pairing by position would mislabel them.
  await writeConversation(dir, id, [userStep('x')], ['Gemini 3.8 Flash (High)', 'Gemini 4 Argon (Medium)']);
  const logs = path.join(dir, '..', 'brain', id, '.system_generated', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const input = (model) => JSON.stringify({ type: 'USER_INPUT', content: `<USER_SETTINGS_CHANGE>\nThe user changed setting \`Model Selection\` from None to ${model}. No need to comment on this change.\n</USER_SETTINGS_CHANGE>` });
  const call = (n) => JSON.stringify({ type: 'PLANNER_RESPONSE', input_tokens: n, output_tokens: 0 });
  fs.writeFileSync(path.join(logs, 'transcript.jsonl'), [
    input('Gemini 3.8 Flash (High)'), call(100), call(200), input('Gemini 4 Argon (Medium)'), call(1000), call(2000),
  ].join('\n'));

  const r = await analyze({ dir });
  const by = (model) => r.models.find((m) => m.model === model);
  assert.equal(by('Gemini 3.8 Flash').input, 300);
  assert.equal(by('Gemini 4 Argon').input, 3000);
  assert.equal(r.models.length, 2);
  assert.deepEqual(r.sessions[0].modelSources, { rows: 2, rowsWithModel: 2, calls: 4, fromTranscript: 4, unknown: 0 });
});

test('a conversation with a single model labels every call with it, even without matching rows', async () => {
  const dir = path.join(tmp, 'models-single', 'conversations');
  const id = '00000071-0000-4000-8000-000000000000';
  await writeConversation(dir, id, [userStep('x')], ['gemini-3.8-flash-medium']);
  writeTranscript(dir, id, [[100, 0, 1], [200, 0, 1], [300, 0, 1]]);
  const r = await analyze({ dir });
  assert.deepEqual(r.models.map((m) => [m.model, m.effort, m.calls, m.input]), [['gemini-3.8-flash', 'medium', 3, 600]]);
});

test('reads the selected model from a settings change', () => {
  const { selectedModel } = require('../lib/history');
  assert.deepEqual(selectedModel('The user changed setting `Model Selection` from None to Gemini 3.8 Flash (High). No need to comment.'), { model: 'Gemini 3.8 Flash', effort: 'High' });
  assert.equal(selectedModel('no settings here'), null);
});
