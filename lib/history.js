// Reads the local Antigravity CLI history (~/.gemini/antigravity-cli/conversations/*.db) and aggregates
// what entered the model context: tool calls, file reads by type/folder/file, re-reads and commands.
// Strictly read-only: databases are copied to a temp dir first and never opened in place.
// Never returns file contents or prompts, only paths, counts and sizes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// The CLI (agy) keeps its history in antigravity-cli; the editor and the VS Code extension in antigravity,
// with the same layout. Both are read by default.
const DEFAULT_DIRS = ['antigravity-cli', 'antigravity'].map((d) => path.join(os.homedir(), '.gemini', d, 'conversations'));
const DEFAULT_DIR = DEFAULT_DIRS[0];
// Which Antigravity a history folder belongs to, from its parent's name; null for any other folder.
// The editor and the VS Code extension share their folder, so they cannot be told apart.
const originOf = (dir) => ({ 'antigravity-cli': 'cli', antigravity: 'editor' })[path.basename(path.dirname(dir))] || null;
const BYTES_PER_TOKEN = 4;
const TOOL_RE = /^[a-z][a-z0-9_]{2,40}$/;
const FILE_KEYS = ['AbsolutePath', 'TargetFile', 'FilePath', 'File', 'Path'];
// Model of a call, as agy names it in gen_metadata: "Gemini 3.8 Flash (High)" (name and effort level), or
// the id "gemini-3.8-flash-high" when the display name is missing.
// Whole strings only, so that prose in the system prompt that mentions a model is not taken for one.
const MODEL_NAME_RE = /^((?:Gemini|Claude|GPT)[\w .-]*?) \(([A-Za-z][A-Za-z ]{1,15})\)$/;
const MODEL_ID_RE = /^((?:gemini|claude|gpt)-[\w.-]*?)-(minimal|low|medium|high|xhigh|max)$/;

function modelOf(strs) {
  for (const s of strs) {
    const m = s.length < 200 && MODEL_NAME_RE.exec(s);
    if (m) return { model: m[1].trim(), effort: m[2].trim() };
  }
  for (const s of strs) {
    const m = s.length < 200 && MODEL_ID_RE.exec(s);
    if (m) return { model: m[1], effort: m[2] };
  }
  return { model: null, effort: null };
}

// agy notes model switches in the user's message: "changed setting `Model Selection` from None to
// Gemini 3.8 Flash (High)." The model in force for every call that follows.
const MODEL_SETTING_RE = /changed setting `Model Selection` from .+? to (.+?)\.(?:\s|$)/g;
function selectedModel(text) {
  let last = null;
  for (const m of String(text).matchAll(MODEL_SETTING_RE)) last = m[1].trim();
  return last && modelOf([last]).model ? modelOf([last]) : null;
}

// A short string that may name a model in a format modelOf() does not know yet: mentions a model family,
// or is an enum-like id ("MODEL_PLACEHOLDER_M26"). Only used for --debug-models.
const looksLikeModel = (s) => s.length <= 60 && !/[\\/:]/.test(s)
  && (/\b(gemini|claude|gpt|model|flash|pro|argon)\b/i.test(s) || /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(s));

// "Gemini 3.8 Flash" and "gemini-3.8-flash", "High" and "high": the same model and effort.
const modelKey = (m) => `${(m.model || '').toLowerCase().replace(/[\s_]+/g, '-')}|${(m.effort || '').toLowerCase()}`;

// --- SQLite access: node:sqlite when the runtime has it (Node >= 22.13), sql.js (WASM) otherwise. ---

let nodeSqlite = null;
try {
  process.removeAllListeners('warning');
  nodeSqlite = require('node:sqlite');
} catch { /* not available (older Node, Electron) */ }

let sqlJs = null;
async function openDb(file, tmp) {
  // Always work on a copy (with its WAL): agy keeps these files open, and the originals stay untouched.
  const copy = path.join(tmp, path.basename(file));
  for (const s of ['', '-wal']) if (fs.existsSync(file + s)) fs.copyFileSync(file + s, copy + s);
  if (nodeSqlite) {
    const conn = new nodeSqlite.DatabaseSync(copy);
    return {
      all: (sql) => conn.prepare(sql).all().map((r) => Object.values(r)),
      close: () => conn.close(),
    };
  }
  // sql.js (vendored, see vendor/sql.js/VERSION) only sees the main file: pages still in the -wal
  // (the very latest steps) are missed.
  const vendor = path.join(__dirname, '..', 'vendor', 'sql.js');
  sqlJs = sqlJs || (await require(path.join(vendor, 'sql-wasm.js'))({ locateFile: (f) => path.join(vendor, f) }));
  const db = new sqlJs.Database(fs.readFileSync(copy));
  return {
    all: (sql) => (db.exec(sql)[0]?.values || []),
    close: () => db.close(),
  };
}

// --- Schema-less protobuf walk: collects every string at any depth. ---

function strings(buf, out = [], depth = 0) {
  let i = 0;
  const varint = () => {
    let v = 0, s = 0, b;
    do { if (i >= buf.length) throw 0; b = buf[i++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80);
    return v;
  };
  try {
    while (i < buf.length) {
      const wt = varint() & 7;
      if (wt === 0) varint();
      else if (wt === 1) i += 8;
      else if (wt === 5) i += 4;
      else if (wt === 2) {
        const len = varint();
        if (i + len > buf.length) throw 0;
        const sub = buf.subarray(i, i + len);
        i += len;
        const before = out.length;
        if (depth < 40 && strings(sub, out, depth + 1)) continue;
        out.length = before;
        const s = sub.toString('utf8');
        if (!s.includes('\uFFFD')) out.push(s);
      } else throw 0;
    }
    return true;
  } catch { return false; }
}

function collect(blob) {
  const out = [];
  if (blob) strings(Buffer.from(blob), out);
  return out;
}

// The top-level fields of one protobuf message: tag -> varint value or bytes (last one wins). Null if malformed.
function fields(buf) {
  const out = new Map();
  let i = 0;
  const varint = () => {
    let v = 0, s = 0, b;
    do { if (i >= buf.length) throw 0; b = buf[i++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80);
    return v;
  };
  try {
    while (i < buf.length) {
      const k = varint(), tag = Math.floor(k / 8), wt = k & 7;
      if (wt === 0) out.set(tag, varint());
      else if (wt === 1) i += 8;
      else if (wt === 5) i += 4;
      else if (wt === 2) { const len = varint(); if (i + len > buf.length) throw 0; out.set(tag, buf.subarray(i, i + len)); i += len; } else throw 0;
    }
    return out;
  } catch { return null; }
}

// Token counts of one gen_metadata row (one model call): field 1 › 4 holds 2 = input, 3 = output,
// 5 = cache read, the same figures the transcript logs. Null when the row has none: some logs (seen
// with the VS Code plugin) carry no token counts, and this is then the only place that has them.
function metaUsage(blob) {
  const top = blob && fields(Buffer.from(blob));
  const call = Buffer.isBuffer(top?.get(1)) && fields(top.get(1));
  const u = Buffer.isBuffer(call?.get(4)) && fields(call.get(4));
  if (!u || !(u.has(2) || u.has(3))) return null;
  const n = (k) => (typeof u.get(k) === 'number' ? u.get(k) : 0);
  return { input: n(2), output: n(3), cache: n(5) };
}

// A tool call is stored as the tool name followed (within a few strings) by its JSON arguments,
// e.g. "view_file" + {"AbsolutePath":"C:\\dev\\...\\X.cs","StartLine":301,"EndLine":380}.
// The call id ("call_5859111") just before the name identifies the call: agy stores each call twice,
// in the model response that requests it and in the step that holds its result.
function toolCalls(strs) {
  const calls = new Map();
  strs.forEach((s, i) => {
    if (s[0] !== '{' || calls.has(s)) return;
    let args;
    try { args = JSON.parse(s); } catch { return; }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return;
    const at = [i - 1, i - 2, i - 3].find((j) => j >= 0 && TOOL_RE.test(strs[j]));
    if (at === undefined) return;
    const id = [at - 1, at - 2, at - 3].map((j) => strs[j]).find((x) => /^call_[\w-]+$/.test(x || ''));
    calls.set(s, { name: strs[at], args, id: id || `${strs[at]}|${s}` });
  });
  return [...calls.values()];
}

// --- Classification ---

// Forward slashes, and escaped/duplicated separators collapsed ("C:\\\\dev" inside JSON → "C:/dev").
const norm = (p) => p.replace(/[\\/]+/g, '/');
const key = (p) => norm(p).toLowerCase().replace(/\/+$/, '');

// Types that are rarely needed in the context: their reads are reported as findings.
// Kinds are stable ids; i18n.kindLabel() turns them into text.
const NON_SOURCE = new Set(['node_modules', 'build', 'lockfiles', 'logs', 'generated']);

// Antigravity's own files: ~/.gemini (CLI, editor, brain, skills) and its editor extensions.
const isAgentFile = (p) => /(^|\/)\.gemini\//i.test(p) || /(^|\/)\.[\w-]+\/extensions\/[^/]*antigravity[^/]*\//i.test(p);

// --- Images ---

// The model gets images as pixels, not bytes: Gemini counts 258 tokens for an image up to 384×384 px, and
// 258 per 768×768 tile above that. Their stored size / 4 would count a screenshot as ~100,000 tokens.
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const TILE_TOKENS = 258;
const UNKNOWN_IMAGE_TOKENS = 4 * TILE_TOKENS; // a typical screenshot, when the file can't be read

// Width and height from the file's header (PNG, GIF, BMP, WebP, JPEG), or null.
function imageSize(file) {
  let b;
  try {
    const fd = fs.openSync(file, 'r');
    b = Buffer.alloc(64 * 1024);
    b = b.subarray(0, fs.readSync(fd, b, 0, b.length, 0));
    fs.closeSync(fd);
  } catch { return null; }
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.length >= 10 && b.toString('latin1', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (b.length >= 26 && b.toString('latin1', 0, 2) === 'BM') return [b.readInt32LE(18), Math.abs(b.readInt32LE(22))];
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const f = b.toString('latin1', 12, 16);
    if (f === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (f === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (f === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

const imageCache = new Map();
function imageTokens(file) {
  if (!imageCache.has(file)) {
    const size = imageSize(file);
    const [w, h] = size && size[0] > 0 && size[1] > 0 ? size : [0, 0];
    imageCache.set(file, !w ? UNKNOWN_IMAGE_TOKENS
      : w <= 384 && h <= 384 ? TILE_TOKENS : Math.ceil(w / 768) * Math.ceil(h / 768) * TILE_TOKENS);
  }
  return imageCache.get(file);
}

/**
 * @param {string} p path with "/" separators
 * @param {object} [opts]
 * @param {boolean} [opts.inRepo] git says the file is part of the repo (not ignored): a build/ or bin/
 *   folder then holds sources (webpack config, CLI scripts), not build output.
 */
function kind(p, { inRepo = false } = {}) {
  // Antigravity's own data (the agent's brain: plans, artifacts, logs; and skills): it needs them, so they
  // are never reported as generated or proposed for exclusion, whatever their names look like. The same for
  // the Antigravity extension installed in an editor (~/.vscode/extensions/google.google-antigravity-…).
  if (isAgentFile(p)) return 'agent';
  if (/(^|\/)node_modules\//.test(p)) return 'node_modules';
  if (!inRepo && /(^|\/)(dist|build|out|target|coverage|allure-results|allure-report|\.next|bin|obj)\//i.test(p)) return 'build';
  if (/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|packages\.lock\.json|\.lock)$/.test(p)) return 'lockfiles';
  if (/\.(log|map)$|\.min\.(js|css)$/.test(p)) return 'logs';
  if (IMAGE_RE.test(p)) return 'images';
  if (/(^|\/)(tests?|__tests__|specs?)\//i.test(p) || /\.(test|spec|tests?)\.\w+$/i.test(p) || /Tests?\//.test(p)) return 'tests';
  if (/\.designer\.cs$|\.g\.cs$|\.generated\.\w+$|(^|\/)(generated|Migrations)\//i.test(p)) return 'generated';
  const ext = path.extname(p).toLowerCase();
  return ext ? `code ${ext}` : 'other';
}

// Files of a git repo that git does not ignore (tracked, or untracked and not ignored), lowercased and
// relative to the root; null when git cannot tell (no git, or the repo is not on this machine).
const repoFilesCache = new Map();
function repoFiles(root) {
  if (!repoFilesCache.has(root)) {
    const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true });
    repoFilesCache.set(root, git.status === 0 ? new Set(git.stdout.split('\0').filter(Boolean).map((f) => f.toLowerCase())) : null);
  }
  return repoFilesCache.get(root);
}

// Project root of a file: an explicit workspace containing it, or else the nearest folder with a .git
// entry, when the path exists on this machine. Null when unknown (e.g. a repo that was deleted).
const rootCache = new Map();
function projectRoot(file, workspaces) {
  const k = key(file);
  const ws = workspaces.find((w) => k.startsWith(key(w) + '/'));
  if (ws) return norm(ws).replace(/\/+$/, '');
  // Only absolute paths are walked ("/x" or "C:/x"): dirname would otherwise end at "." (the cwd).
  const isAbs = (d) => /^(\/[^/]|[A-Za-z]:\/.)/.test(d);
  let dir = path.posix.dirname(norm(file));
  const visited = [];
  let root = null;
  while (isAbs(dir)) {
    if (rootCache.has(dir)) { root = rootCache.get(dir); break; }
    visited.push(dir);
    try { if (fs.existsSync(`${dir}/.git`)) { root = dir; break; } } catch { /* unreadable: keep walking */ }
    dir = path.posix.dirname(dir);
  }
  for (const v of visited) rootCache.set(v, root);
  return root;
}

// Grouping info for a file: its project, its path relative to it, and its folder (at most `depth` levels).
function locate(file, workspaces, depth = 3) {
  const root = projectRoot(file, workspaces);
  const rel = root ? norm(file).slice(root.length + 1) : norm(file);
  const parts = path.posix.dirname(rel).split('/').filter((x) => x && x !== '.');
  const folderRel = parts.slice(0, depth).join('/');
  const folderAbs = root ? (folderRel ? `${root}/${folderRel}` : root) : path.posix.dirname(norm(file));
  return { root, project: root ? path.posix.basename(root) : null, rel, folderRel: root ? folderRel || '.' : folderAbs, folderAbs };
}

// --- Real usage ---

// Local calendar day of a time, as YYYY-MM-DD.
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// What the model was actually billed for in a conversation, from the transcript agy keeps next to the
// history (<conversations>/../brain/<id>/.system_generated/logs/transcript.jsonl): one line per step,
// and model calls carry input, cache-read and output tokens. Subagents have their own conversation and
// transcript. Null when there is no transcript (older agy, or another layout).
function realUsage(dir, id) {
  const file = path.join(dir, '..', 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  // `days`: the same figures per local day of each model call (calls without a time go under null).
  // `perCall`: each call's figures, in order, and the model selected in the transcript when it was made.
  // `calls` counts only the calls that carry token counts; some logs (seen with the VS Code plugin) list
  // calls without them, and counting those as 0 tokens would drag every per-call figure down.
  // `unmetered`: those other calls, and `unmeteredKeys` the field names they do have, for --debug-models.
  const u = { calls: 0, input: 0, cache: 0, output: 0, errors: 0, start: null, end: null, days: new Map(), perCall: [], unmetered: 0, unmeteredKeys: new Set() };
  let selected = null;
  u.unrecognized = new Set();
  for (const line of text.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const at = Date.parse(e.created_at);
    if (at) { u.start = Math.min(u.start ?? at, at); u.end = Math.max(u.end ?? at, at); }
    if (e.status === 'ERROR') u.errors++;
    if (e.type === 'USER_INPUT') {
      selected = selectedModel(e.content) || selected;
      // Model names agy selected that modelOf() does not understand, for --debug-models.
      for (const m of String(e.content).matchAll(MODEL_SETTING_RE)) if (!modelOf([m[1].trim()]).model) u.unrecognized.add(m[1].trim().slice(0, 60));
    }
    if (e.type !== 'PLANNER_RESPONSE') continue;
    if (!['input_tokens', 'cache_read_tokens', 'output_tokens'].some((k) => k in e)) {
      u.unmetered++;
      for (const k of Object.keys(e)) if (k.length < 40) u.unmeteredKeys.add(k);
      u.perCall.push({ metered: false, model: selected, at });
      continue;
    }
    u.calls++;
    u.input += Number(e.input_tokens) || 0;
    u.cache += Number(e.cache_read_tokens) || 0;
    u.output += Number(e.output_tokens) || 0;
    u.perCall.push({ metered: true, input: Number(e.input_tokens) || 0, cache: Number(e.cache_read_tokens) || 0, output: Number(e.output_tokens) || 0, model: selected });
    const k = at ? dayKey(at) : null;
    const d = u.days.get(k) || { calls: 0, input: 0, cache: 0, output: 0 };
    d.calls++;
    d.input += Number(e.input_tokens) || 0;
    d.cache += Number(e.cache_read_tokens) || 0;
    d.output += Number(e.output_tokens) || 0;
    u.days.set(k, d);
  }
  return u;
}

// Real usage rebuilt from gen_metadata, one row per model call, for conversations whose log has no token
// counts (or no log). Each row's call keeps the model and day of the log's n-th call when there is one.
function usageFromMeta(blobs, log, end) {
  const rows = blobs.map(metaUsage);
  if (!rows.some(Boolean)) return null;
  const u = { calls: 0, input: 0, cache: 0, output: 0, errors: log?.errors || 0, start: log?.start ?? null, end: log?.end ?? null,
    days: new Map(), perCall: [], unmetered: 0, unmeteredKeys: new Set(), unrecognized: log?.unrecognized || new Set(), fromMeta: true };
  rows.forEach((x, i) => {
    const from = log?.perCall[i];
    if (!x) { u.perCall.push({ metered: false, model: from?.model || null }); return; }
    u.calls++;
    u.input += x.input; u.cache += x.cache; u.output += x.output;
    u.perCall.push({ metered: true, ...x, model: from?.model || null });
    const k = dayKey(from?.at || log?.end || end);
    const d = u.days.get(k) || { calls: 0, input: 0, cache: 0, output: 0 };
    d.calls++; d.input += x.input; d.cache += x.cache; d.output += x.output;
    u.days.set(k, d);
  });
  return u;
}

// --- Titles ---

// The short title agy gives each conversation ("Analyzing Package Lock Dependencies"), from
// <conversations>/../conversation_summaries.db; older ones only have it as `preview`. Empty map when
// the file is missing or unreadable: the report then falls back to the conversation id.
async function conversationTitles(dir, tmp) {
  const titles = new Map();
  const file = path.join(dir, '..', 'conversation_summaries.db');
  if (!fs.existsSync(file)) return titles;
  let db;
  try {
    db = await openDb(file, tmp);
    for (const [id, title, preview] of db.all('select conversation_id, title, preview from conversation_summaries')) {
      const name = String(title || preview || '').trim().slice(0, 80);
      if (name) titles.set(String(id), name);
    }
  } catch { /* no titles */ } finally { db?.close(); }
  return titles;
}

// --- Aggregation ---

class Counter {
  constructor() { this.m = new Map(); }
  // Numeric fields are summed; `meta` is stored the first time a key is seen, except `origin`, which is
  // collected into `origins` (every origin that touched the key).
  add(k, fields, { origin, ...meta } = {}) {
    let e = this.m.get(k);
    if (!e) this.m.set(k, (e = { key: k, calls: 0, tokens: 0, rereads: 0, rereadTokens: 0, convs: 0, ...meta }));
    for (const [f, v] of Object.entries(fields)) e[f] = (e[f] || 0) + v;
    if (origin !== undefined && !(e.origins ||= []).includes(origin)) e.origins.push(origin);
  }
  all() { return [...this.m.values()].sort((a, b) => b.tokens - a.tokens || b.calls - a.calls); }
}

/**
 * @param {object} opts
 * @param {string|string[]} [opts.dir] conversations directory, or several (the CLI's and the editor's by default)
 * @param {string[]} [opts.workspaces] only count conversations that touched these folders (all if empty)
 * @param {Object<string,string>} [opts.customKinds] regex -> label, checked before the built-in types
 * @param {number} [opts.since] only conversations whose last activity is at or after this time (ms)
 */
// `session`: only the conversations whose id starts with it; each one then also lists what entered its
// context (`contents`), to explain why it cost what it did.
async function analyze({ dir: dirs = DEFAULT_DIRS, workspaces = [], customKinds = {}, since = null, session = null } = {}) {
  dirs = [].concat(dirs);
  // The folders that exist, for the report's header; all of them when none does, to say where it looked.
  const dir = (dirs.filter((d) => fs.existsSync(d)).length ? dirs.filter((d) => fs.existsSync(d)) : dirs).join(' + ');
  const custom = Object.entries(customKinds).map(([re, label]) => [new RegExp(re, 'i'), label]);
  // A file git keeps in the repo is never build output, whatever its folder is called.
  // Antigravity's own files stay 'agent' even when a custom type matches them: they must never be excluded.
  const classify = (p, root, rel) => (isAgentFile(p) ? 'agent' : custom.find(([re]) => re.test(p))?.[1])
    || kind(p, { inRepo: Boolean(root && repoFiles(root)?.has(rel.toLowerCase())) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-insights-'));
  const r = {
    dir, backend: nodeSqlite ? 'node:sqlite' : 'sql.js', conversations: 0, unreadable: 0, steps: 0, tokens: 0,
    since, period: null, olderSkipped: 0,
    toolCallsFound: 0, reads: 0, rangedReads: 0, linesRead: 0, rereads: 0, rereadTokens: 0, sessions: [],
    usage: { conversations: 0, calls: 0, input: 0, cache: 0, output: 0, errors: 0 },
  };
  const tools = new Counter(), kinds = new Counter(), folders = new Counter(), files = new Counter();
  const commands = new Counter(), projects = new Counter();
  const models = new Map(); // "model|effort" -> calls and real tokens
  const daily = new Map(); // YYYY-MM-DD -> real usage that day
  const firstDay = since ? dayKey(since) : '';
  const wsKeys = workspaces.map(key);

  try {
    const dbs = dirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^[0-9a-f-]{36}\.db$/i.test(f)).map((f) => [d, f]) : []));
    const titles = new Map();
    // The editor's summaries also list CLI conversations, sometimes with just a preview: the first folder's title wins.
    for (const d of dirs) for (const [k, v] of await conversationTitles(d, tmp)) if (!titles.has(k)) titles.set(k, v);
    for (const [dir, f] of dbs) {
      // When it happened: the transcript's step times, else the database's last write.
      const id = f.replace(/\.db$/, '');
      if (session && !id.toLowerCase().startsWith(session.toLowerCase())) continue;
      const log = realUsage(dir, id);
      const origin = originOf(dir);
      const end = log?.end ?? fs.statSync(path.join(dir, f)).mtimeMs;
      const start = log?.start ?? end;
      // Real usage from the log when it has token counts; else from gen_metadata (below), else the estimate.
      let usage = log?.calls ? log : null;
      if (since && end < since) { r.olderSkipped++; continue; }
      let db;
      try { db = await openDb(path.join(dir, f), tmp); } catch { r.unreadable++; continue; }
      try {
        const rows = db.all('select length(step_payload), step_payload from steps');
        const steps = rows.map(([len, blob]) => ({ bytes: Number(len) || 0, strs: collect(blob) }));

        if (wsKeys.length) {
          const touches = steps.some((s) => s.strs.some((x) => x.length < 2000 && wsKeys.some((w) => key(x).includes(w))));
          if (!touches) continue;
        }

        r.conversations++;
        r.period = { from: Math.min(r.period?.from ?? start, start), to: Math.max(r.period?.to ?? end, end) };
        let convBytes = 0;
        const seenRanges = new Set(), seenFiles = new Set(), seenFolders = new Set(), seenKinds = new Set(), seenProjects = new Set();
        const seenCalls = new Map(); // call id -> 1 if that call re-read a range already read, else 0
        const once = (set, k) => (set.has(k) ? 0 : (set.add(k), 1));
        const contents = new Map(); // with `session`: "tool|file or command" -> calls, ~tokens and re-reads
        const content = (name, target, fields) => {
          const k = `${name}|${target ? key(target) : ''}`;
          const e = contents.get(k) || { name, target, calls: 0, tokens: 0, rereads: 0 };
          e.calls += fields.calls;
          e.tokens += fields.tokens;
          e.rereads += fields.rereads;
          contents.set(k, e);
        };
        for (const { bytes, strs } of steps) {
          r.steps++;
          convBytes += bytes;
          // The step payload also carries the tool result: its size approximates what entered the context.
          toolCalls(strs).forEach((c, i) => {
            const fk = FILE_KEYS.find((k) => typeof c.args[k] === 'string');
            const read = fk && /^(view_file|read_)/.test(c.name) ? norm(c.args[fk]) : null;
            // A call is counted once (first time its id shows up); every step that carries it adds its size.
            // An image read counts what the model gets from its pixels, not the bytes stored in the step.
            let tokens = i === 0 ? bytes / BYTES_PER_TOKEN : 0;
            if (tokens && read && IMAGE_RE.test(read)) {
              const image = Math.min(tokens, imageTokens(read));
              convBytes -= (tokens - image) * BYTES_PER_TOKEN;
              tokens = image;
            }
            const isNew = !seenCalls.has(c.id);
            if (isNew) seenCalls.set(c.id, 0);
            const calls = isNew ? 1 : 0;
            r.toolCallsFound += calls;
            tools.add(c.name, { calls, tokens });
            if (c.name === 'run_command' && typeof c.args.CommandLine === 'string') {
              commands.add(c.args.CommandLine.trim().split(/\s+/).slice(0, 2).join(' '), { calls, tokens });
              if (session) content(c.name, c.args.CommandLine.trim().slice(0, 120), { calls, tokens, rereads: 0 });
            } else if (session && !read) content(c.name, null, { calls, tokens, rereads: 0 });
            if (!read) return;

            const file = read;
            const { StartLine: s, EndLine: e } = c.args;
            if (isNew) {
              const range = `${key(file)}|${s}-${e}`;
              seenCalls.set(c.id, seenRanges.has(range) ? 1 : 0);
              seenRanges.add(range);
              r.reads++;
              r.rereads += seenCalls.get(c.id);
              if (Number.isFinite(s) && Number.isFinite(e)) { r.rangedReads++; r.linesRead += e - s + 1; }
            }
            const reread = seenCalls.get(c.id);
            r.rereadTokens += reread * tokens;
            if (session) content(c.name, file, { calls, tokens, rereads: isNew ? reread : 0 });

            // Folders and files are keyed by absolute path: several projects can share relative paths.
            const { root, project, rel, folderRel, folderAbs } = locate(file, workspaces);
            const k = classify(file, root, rel);
            const fields = { calls, tokens, rereads: isNew ? reread : 0, rereadTokens: reread * tokens };
            kinds.add(k, { ...fields, convs: once(seenKinds, k) }, { nonSource: NON_SOURCE.has(k) });
            projects.add(root || '', { ...fields, convs: once(seenProjects, root || '') }, { project });
            // `origin`: which Antigravity read it (CLI or editor), so exclusions point to the right settings.
            folders.add(key(folderAbs), { ...fields, convs: once(seenFolders, key(folderAbs)) }, { abs: folderAbs, rel: folderRel, root, project, origin });
            files.add(key(file), { ...fields, convs: once(seenFiles, key(file)) }, { abs: file, rel, root, project, kind: k, origin });
          });
        }
        const metaBlobs = db.all('select data from gen_metadata order by idx').map(([blob]) => blob);
        if (!usage) usage = usageFromMeta(metaBlobs, log, end);
        if (usage) {
          r.usage.conversations++;
          for (const k of ['calls', 'input', 'cache', 'output', 'errors']) r.usage[k] += usage[k];
          for (const [k, v] of usage.days) {
            const day = k || dayKey(end);
            if (day < firstDay) continue;
            const d = daily.get(day) || { day, calls: 0, input: 0, cache: 0, output: 0 };
            for (const f of ['calls', 'input', 'cache', 'output']) d[f] += v[f];
            daily.set(day, d);
          }
        }
        // Model of each call. gen_metadata usually has one row per call, in the transcript's order; when the
        // counts match, the n-th row is the n-th call. When they don't, pairing by position would mislabel
        // calls, so the model selected in the transcript is used instead, or the conversation's only model.
        const metaStrs = metaBlobs.map(collect);
        const metaRows = metaStrs.map(modelOf);
        const calls = usage?.fromMeta ? usage.perCall : log ? log.perCall : metaRows.map(() => null);
        const aligned = metaRows.length === calls.length;
        const rowModels = new Set(metaRows.filter((m) => m.model).map(modelKey));
        const onlyModel = rowModels.size === 1 ? metaRows.find((m) => m.model) : null;
        const callModels = calls.map((c, i) => {
          if (aligned && metaRows[i].model) return metaRows[i];
          return c?.model || onlyModel || { model: null, effort: null };
        });
        const seenModels = new Set(), counts = new Map();
        callModels.forEach((m, i) => {
          const k = modelKey(m);
          const e = models.get(k) || { model: m.model, effort: m.effort, calls: 0, convs: 0, input: 0, cache: 0, output: 0, known: 0 };
          // Prefer the display name ("Gemini 3.8 Flash", "High") over the id spelling.
          if (m.model && /[A-Z ]/.test(m.model) && !/[A-Z ]/.test(e.model || '')) { e.model = m.model; e.effort = m.effort; }
          e.calls++;
          if (!seenModels.has(k)) { seenModels.add(k); e.convs++; }
          const c = calls[i];
          if (c?.metered) { e.known++; e.input += c.input; e.cache += c.cache; e.output += c.output; }
          models.set(k, e);
          if (m.model) counts.set(k, (counts.get(k) || 0) + 1);
        });
        // The session's model: the one that made most of its calls.
        const main = [...counts].sort((a, b) => b[1] - a[1])[0];
        const model = main ? models.get(main[0]) : null;
        r.sessions.push({
          id, title: titles.get(id) || null, origin, start, end, steps: steps.length, tokens: convBytes / BYTES_PER_TOKEN, usage,
          model: model ? { model: model.model, effort: model.effort } : null, models: counts.size,
          // For --debug-models: where each call's model came from, and for rows where no model was recognized,
          // the short strings that look like a model id (to spot a new format). Never prompts, paths or code.
          modelSources: { rows: metaRows.length, rowsWithModel: metaRows.filter((m) => m.model).length, calls: calls.length,
            fromTranscript: calls.filter((c) => c?.model).length, unknown: callModels.filter((m) => !m.model).length,
            unmetered: log?.unmetered || 0, unmeteredKeys: [...(log?.unmeteredKeys || [])].sort(),
            candidates: [...new Set([...(log?.unrecognized || []),
              ...metaStrs.filter((_, i) => !metaRows[i].model).flat().filter(looksLikeModel)])].slice(0, 10) },
          ...(session && { contents: [...contents.values()].sort((a, b) => b.tokens - a.tokens) }),
        });
        r.tokens += convBytes / BYTES_PER_TOKEN;
      } catch { r.unreadable++; } finally { db.close(); }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Biggest first: by real usage when transcripts exist, else by the stored-size estimate.
  const billed = (s) => (s.usage ? s.usage.input + s.usage.output : -1);
  r.sessions.sort((a, b) => billed(b) - billed(a) || b.tokens - a.tokens);
  // Many steps but no recognizable tool call: agy probably changed its storage format.
  r.formatUnrecognized = r.steps > 50 && r.toolCallsFound === 0;
  // Conversations and real usage per origin (CLI, editor), biggest first.
  const origins = new Map();
  for (const s of r.sessions) {
    const o = origins.get(s.origin) || { origin: s.origin, conversations: 0, calls: 0, input: 0, cache: 0, output: 0 };
    o.conversations++;
    if (s.usage) for (const k of ['calls', 'input', 'cache', 'output']) o[k] += s.usage[k];
    origins.set(s.origin, o);
  }
  return {
    ...r,
    origins: [...origins.values()].sort((a, b) => b.input + b.output - (a.input + a.output) || b.conversations - a.conversations),
    tools: tools.all(), kinds: kinds.all(), folders: folders.all(), files: files.all(), projects: projects.all(),
    commands: commands.all(),
    models: [...models.values()].sort((a, b) => b.input + b.output - (a.input + a.output) || b.calls - a.calls),
    daily: [...daily.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
  };
}

module.exports = { analyze, DEFAULT_DIR, DEFAULT_DIRS, kind, isAgentFile, imageTokens, NON_SOURCE, realUsage, dayKey, modelOf, selectedModel, repoFiles };
