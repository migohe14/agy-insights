// Reads the local Antigravity CLI history (~/.gemini/antigravity-cli/conversations/*.db) and aggregates
// what entered the model context: tool calls, file reads by type/folder/file, re-reads and commands.
// Strictly read-only: databases are copied to a temp dir first and never opened in place.
// Never returns file contents or prompts, only paths, counts and sizes.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DIR = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations');
const BYTES_PER_TOKEN = 4;
const TOOL_RE = /^[a-z][a-z0-9_]{2,40}$/;
const FILE_KEYS = ['AbsolutePath', 'TargetFile', 'FilePath', 'File', 'Path'];
const MODEL_RE = /\b(gemini-[\w.-]+|Gemini \d[\w. ]*\((?:Low|Medium|High)\)|Claude \w+ [\d.]+ \(\w+\))/g;

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

function kind(p) {
  if (/(^|\/)node_modules\//.test(p)) return 'node_modules';
  if (/(^|\/)(dist|build|out|target|coverage|\.next|bin|obj)\//i.test(p)) return 'build';
  if (/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|packages\.lock\.json|\.lock)$/.test(p)) return 'lockfiles';
  if (/\.(log|map)$|\.min\.(js|css)$/.test(p)) return 'logs';
  if (/(^|\/)(tests?|__tests__|specs?)\//i.test(p) || /\.(test|spec|tests?)\.\w+$/i.test(p) || /Tests?\//.test(p)) return 'tests';
  if (/\.designer\.cs$|\.g\.cs$|\.generated\.\w+$|(^|\/)(generated|Migrations)\//i.test(p)) return 'generated';
  const ext = path.extname(p).toLowerCase();
  return ext ? `code ${ext}` : 'other';
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
  const u = { calls: 0, input: 0, cache: 0, output: 0, errors: 0, start: null, end: null, days: new Map() };
  for (const line of text.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const at = Date.parse(e.created_at);
    if (at) { u.start = Math.min(u.start ?? at, at); u.end = Math.max(u.end ?? at, at); }
    if (e.status === 'ERROR') u.errors++;
    if (e.type !== 'PLANNER_RESPONSE') continue;
    u.calls++;
    u.input += Number(e.input_tokens) || 0;
    u.cache += Number(e.cache_read_tokens) || 0;
    u.output += Number(e.output_tokens) || 0;
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

// --- Aggregation ---

class Counter {
  constructor() { this.m = new Map(); }
  // Numeric fields are summed; `meta` is stored the first time a key is seen.
  add(k, fields, meta = {}) {
    let e = this.m.get(k);
    if (!e) this.m.set(k, (e = { key: k, calls: 0, tokens: 0, rereads: 0, rereadTokens: 0, convs: 0, ...meta }));
    for (const [f, v] of Object.entries(fields)) e[f] = (e[f] || 0) + v;
  }
  all() { return [...this.m.values()].sort((a, b) => b.tokens - a.tokens || b.calls - a.calls); }
}

/**
 * @param {object} opts
 * @param {string} [opts.dir] conversations directory
 * @param {string[]} [opts.workspaces] only count conversations that touched these folders (all if empty)
 * @param {Object<string,string>} [opts.customKinds] regex -> label, checked before the built-in types
 * @param {number} [opts.since] only conversations whose last activity is at or after this time (ms)
 */
async function analyze({ dir = DEFAULT_DIR, workspaces = [], customKinds = {}, since = null } = {}) {
  const custom = Object.entries(customKinds).map(([re, label]) => [new RegExp(re, 'i'), label]);
  const classify = (p) => custom.find(([re]) => re.test(p))?.[1] || kind(p);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-insights-'));
  const r = {
    dir, backend: nodeSqlite ? 'node:sqlite' : 'sql.js', conversations: 0, unreadable: 0, steps: 0, tokens: 0,
    since, period: null, olderSkipped: 0,
    toolCallsFound: 0, reads: 0, rangedReads: 0, linesRead: 0, rereads: 0, rereadTokens: 0, sessions: [],
    usage: { conversations: 0, calls: 0, input: 0, cache: 0, output: 0, errors: 0 },
  };
  const tools = new Counter(), kinds = new Counter(), folders = new Counter(), files = new Counter();
  const commands = new Counter(), models = new Counter(), projects = new Counter();
  const daily = new Map(); // YYYY-MM-DD -> real usage that day
  const firstDay = since ? dayKey(since) : '';
  const wsKeys = workspaces.map(key);

  try {
    const dbs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[0-9a-f-]{36}\.db$/i.test(f)) : [];
    for (const f of dbs) {
      // When it happened: the transcript's step times, else the database's last write.
      const id = f.replace(/\.db$/, '');
      const usage = realUsage(dir, id);
      const end = usage?.end ?? fs.statSync(path.join(dir, f)).mtimeMs;
      const start = usage?.start ?? end;
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
        for (const { bytes, strs } of steps) {
          r.steps++;
          convBytes += bytes;
          // The step payload also carries the tool result: its size approximates what entered the context.
          toolCalls(strs).forEach((c, i) => {
            // A call is counted once (first time its id shows up); every step that carries it adds its size.
            const tokens = i === 0 ? bytes / BYTES_PER_TOKEN : 0;
            const isNew = !seenCalls.has(c.id);
            if (isNew) seenCalls.set(c.id, 0);
            const calls = isNew ? 1 : 0;
            r.toolCallsFound += calls;
            tools.add(c.name, { calls, tokens });
            if (c.name === 'run_command' && typeof c.args.CommandLine === 'string') {
              commands.add(c.args.CommandLine.trim().split(/\s+/).slice(0, 2).join(' '), { calls, tokens });
            }
            const fk = FILE_KEYS.find((k) => typeof c.args[k] === 'string');
            if (!fk || !/^(view_file|read_)/.test(c.name)) return;

            const file = norm(c.args[fk]);
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

            // Folders and files are keyed by absolute path: several projects can share relative paths.
            const { root, project, rel, folderRel, folderAbs } = locate(file, workspaces);
            const k = classify(file);
            const fields = { calls, tokens, rereads: isNew ? reread : 0, rereadTokens: reread * tokens };
            kinds.add(k, { ...fields, convs: once(seenKinds, k) }, { nonSource: NON_SOURCE.has(k) });
            projects.add(root || '', { ...fields, convs: once(seenProjects, root || '') }, { project });
            folders.add(key(folderAbs), { ...fields, convs: once(seenFolders, key(folderAbs)) }, { abs: folderAbs, rel: folderRel, root, project });
            files.add(key(file), { ...fields, convs: once(seenFiles, key(file)) }, { abs: file, rel, root, project, kind: k });
          });
        }
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
        r.sessions.push({ id, start, end, steps: steps.length, tokens: convBytes / BYTES_PER_TOKEN, usage });
        r.tokens += convBytes / BYTES_PER_TOKEN;
        for (const [blob] of db.all('select data from gen_metadata')) {
          for (const s of collect(blob)) for (const m of s.matchAll(MODEL_RE)) models.add(m[1], { calls: 1 });
        }
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
  return {
    ...r,
    tools: tools.all(), kinds: kinds.all(), folders: folders.all(), files: files.all(), projects: projects.all(),
    commands: commands.all(), models: models.all(),
    daily: [...daily.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
  };
}

module.exports = { analyze, DEFAULT_DIR, kind, NON_SOURCE, realUsage, dayKey };
