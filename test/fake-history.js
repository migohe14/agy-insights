// Builds fake Antigravity CLI conversation databases with the same shape as real ones: a `steps` table
// whose payload is protobuf, where each tool call carries its name and JSON arguments (stored twice,
// as agy does), plus a `gen_metadata` table mentioning the model. All names are invented.
const fs = require('fs');
const path = require('path');

const vendor = path.join(__dirname, '..', 'vendor', 'sql.js');
const initSqlJs = require(path.join(vendor, 'sql-wasm.js'));

const varint = (n) => {
  const b = [];
  while (n > 127) { b.push((n & 127) | 128); n = Math.floor(n / 128); }
  b.push(n);
  return Buffer.from(b);
};
const field = (tag, data) => {
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return Buffer.concat([varint((tag << 3) | 2), varint(d.length), d]);
};

let callId = 0;
// A tool call, stored as agy does: the model response that requests it, then the step with its result
// (`size` bytes). Both carry the same call id, name and arguments; the result step repeats them.
function step(tool, args, size) {
  const id = `call_${++callId}`;
  const call = Buffer.concat([field(1, id), field(2, tool), field(3, JSON.stringify(args))]);
  return [
    field(1, call),
    field(1, Buffer.concat([call, field(9, 'x'.repeat(size)), field(5, field(1, call))])),
  ];
}
const userStep = (text) => field(1, field(1, text));

/** Writes one conversation database. `steps` are payloads from step() (two steps each) and userStep(). */
async function writeConversation(dir, id, stepList, model = 'Gemini 3.8 Flash (Medium)') {
  const steps = stepList.flat();
  const SQL = await initSqlJs({ locateFile: (f) => path.join(vendor, f) });
  const db = new SQL.Database();
  db.run('create table steps (idx integer primary key, step_type integer, step_payload blob)');
  db.run('create table gen_metadata (idx integer primary key, data blob)');
  steps.forEach((s, i) => db.run('insert into steps values (?, ?, ?)', [i, i ? 21 : 14, s]));
  // One gen_metadata row per model call; pass an array for a conversation with several calls.
  [].concat(model).forEach((m, i) => db.run('insert into gen_metadata values (?, ?)', [i, field(1, field(4, m))]));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.db`), Buffer.from(db.export()));
  db.close();
}

/**
 * Writes the transcript agy keeps for a conversation, next to the history (<dir>/../brain/<id>/...):
 * one JSON line per step. `calls` are [input, cacheRead, output] token counts of each model call;
 * `errors` adds that many failed tool steps.
 */
function writeTranscript(dir, id, calls, errors = 0) {
  const logs = path.join(dir, '..', 'brain', id, '.system_generated', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const lines = [{ step_index: 0, source: 'USER', type: 'USER_INPUT', status: 'DONE', content: 'pregunta' }];
  calls.forEach(([input, cache, output]) => lines.push({ step_index: lines.length, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', input_tokens: input, cache_read_tokens: cache, output_tokens: output }));
  for (let i = 0; i < errors; i++) lines.push({ step_index: lines.length, source: 'MODEL', type: 'GENERIC', status: 'ERROR', error: 'file does not exist' });
  fs.writeFileSync(path.join(logs, 'transcript.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

const ACME = 'C:\\dev\\Acme Portal';

/** The standard scenario used by the tests: 3 sessions on "Acme Portal" and 1 on another project. */
async function acmeHistory(dir) {
  const view = (rel, s, e, size = 8000) => step('view_file',
    { AbsolutePath: `${ACME}\\${rel}`, ...(s ? { StartLine: s, EndLine: e } : {}) }, size);
  const svc = 'src\\01-Core\\Domain\\Pedidos\\PedidosService.cs';
  await writeConversation(dir, '00000000-0000-4000-8000-000000000000', [
    userStep('fix the order'),
    view(svc, 301, 380), view(svc, 301, 380),
    step('run_command', { CommandLine: 'dotnet test' }, 150000), step('run_command', { CommandLine: 'dotnet test' }, 150000),
    view('src\\03-Infra\\obj\\Debug\\net8.0\\Infra.AssemblyInfo.g.cs', 0, 0, 30000),
    view('src\\03-Infra\\obj\\Debug\\net8.0\\Contexto.g.cs', 0, 0, 90000),
    ...Array.from({ length: 30 }, (_, i) => view(`src\\02-App\\Handlers\\Handler${i % 6}.cs`, i * 10, i * 10 + 60, 6000)),
  ], 'Gemini 4 Argon (High)');
  await writeConversation(dir, '00000001-0000-4000-8000-000000000000', [
    userStep('check the migration'),
    view(svc, 1, 80), view('src\\04-Data\\Migrations\\20250101_Init.cs', 0, 0, 60000),
    step('grep_search', { SearchPath: ACME, Query: 'Pedido' }, 3000),
  ]);
  await writeConversation(dir, '00000002-0000-4000-8000-000000000000', [
    userStep('build it'), view(svc, 301, 380), step('run_command', { CommandLine: 'dotnet build' }, 40000),
  ]);
  await writeConversation(dir, '00000003-0000-4000-8000-000000000000', [
    userStep('read the readme'), step('view_file', { AbsolutePath: 'C:\\dev\\Inventario\\README.md' }, 2000),
  ]);
}

/** Writes agy's conversation_summaries.db next to the history: `titles` maps conversation id → title. */
async function writeSummaries(dir, titles) {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(vendor, f) });
  const db = new SQL.Database();
  db.run('create table conversation_summaries (conversation_id text primary key, title text not null default "", preview text not null default "")');
  for (const [id, title] of Object.entries(titles)) db.run('insert into conversation_summaries values (?, ?, ?)', [id, title, title]);
  fs.mkdirSync(path.join(dir, '..'), { recursive: true });
  fs.writeFileSync(path.join(dir, '..', 'conversation_summaries.db'), Buffer.from(db.export()));
  db.close();
}

module.exports = { step, userStep, writeConversation, writeTranscript, writeSummaries, acmeHistory, ACME };

// Run directly to create a sample history: node test/fake-history.js <dir>
if (require.main === module) {
  const dir = path.resolve(process.argv[2] || 'test/tmp/history');
  acmeHistory(dir).then(() => console.log(`Historial de ejemplo en ${dir}`));
}
