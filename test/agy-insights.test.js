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
  assert.match(out, /1 conversations without a log/);
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
