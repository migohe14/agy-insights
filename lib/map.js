// Builds a short project map for AGENTS.md from the project's files: main folders, large source files
// (to search before reading them whole) and generated folders not to read. Its size is bounded whatever
// the repo size, because AGENTS.md is sent with every request. Read-only: it only returns text.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { kind, NON_SOURCE } = require('./history');

const START = '<!-- agy-insights:mapa:inicio -->';
const END = '<!-- agy-insights:mapa:fin -->';
const DEFAULTS = { largeLines: 500, maxLarge: 10, maxFolders: 15, maxNames: 6 };
// Never walked when git is not available; with git, ignored files are skipped anyway.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.vs', '.vscode', '.idea', '.gemini', '.agents']);
const BYTES_PER_TOKEN = 4;

// Project files relative to `root`, with "/" separators: tracked plus untracked-but-not-ignored when
// it is a git repo, else a plain walk.
function listFiles(root) {
  const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (git.status === 0) return [...new Set(git.stdout.split('\0').filter(Boolean))];
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); } else if (e.isFile()) out.push(p);
    }
  };
  walk('');
  return out;
}

// Line count of a text file; null for binaries or unreadable files.
function countLines(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  if (buf.subarray(0, 8000).includes(0)) return null;
  let n = 0;
  for (const b of buf) if (b === 10) n++;
  return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n;
}

// The folder a generated file belongs to, up to the segment that makes it generated ("src/X/obj/").
function generatedFolder(rel) {
  const parts = rel.split('/');
  const i = parts.findIndex((p) => /^(node_modules|dist|build|out|target|coverage|\.next|bin|obj|generated|Migrations)$/i.test(p));
  return i >= 0 ? `${parts.slice(0, i + 1).join('/')}/` : null;
}

// Folders to describe: top-level ones, expanded one level when they are mere containers (like src/).
function mainFolders(files, maxFolders) {
  const count = (prefix) => files.filter((f) => f.startsWith(prefix)).length;
  const subdirs = (prefix) => [...new Set(files.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length).split('/'))
    .filter((p) => p.length > 1).map((p) => p[0]))].sort();
  let folders = subdirs('').map((d) => `${d}/`);
  const expanded = [];
  for (const f of folders) {
    const subs = subdirs(f);
    const direct = files.filter((x) => x.startsWith(f) && !x.slice(f.length).includes('/')).length;
    if (subs.length > 1 && subs.length <= maxFolders && direct <= 2) expanded.push(...subs.map((s) => `${f}${s}/`));
    else expanded.push(f);
  }
  folders = expanded.length <= maxFolders ? expanded : folders;
  return folders.slice(0, maxFolders).map((f) => ({ folder: f, files: count(f), subdirs: subdirs(f) }));
}

/**
 * @param {string} root project folder
 * @param {object} [opts] thresholds (see DEFAULTS) and `history`: files from analyze(), to put first the
 *   large files the agent actually reads.
 */
function buildMap(root, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const all = listFiles(root);
  const generated = new Set(), source = [];
  for (const f of all) {
    const g = NON_SOURCE.has(kind(f)) ? generatedFolder(f) : null;
    if (g) generated.add(g); else if (!NON_SOURCE.has(kind(f))) source.push(f);
  }
  const reads = new Map((o.history || []).filter((h) => h.root).map((h) => [`${h.root}/${h.rel}`.toLowerCase(), h.calls]));
  const rootNorm = root.replace(/[\\/]+/g, '/').replace(/\/$/, '');
  const large = source.map((f) => ({ file: f, lines: countLines(path.join(root, f)), reads: reads.get(`${rootNorm}/${f}`.toLowerCase()) || 0 }))
    .filter((x) => x.lines >= o.largeLines)
    .sort((a, b) => b.reads - a.reads || b.lines - a.lines)
    .slice(0, o.maxLarge);

  const lines = ['## Mapa del proyecto', '', '(Generado por agy-insights. Para encontrar algo, empieza por la carpeta que corresponda y busca con grep.)', ''];
  for (const { folder, files, subdirs } of mainFolders(source, o.maxFolders)) {
    const names = subdirs.length ? `: ${subdirs.slice(0, o.maxNames).join(', ')}${subdirs.length > o.maxNames ? '…' : ''}` : '';
    lines.push(`- ${folder}${names} (${files} ${files === 1 ? 'fichero' : 'ficheros'})`);
  }
  if (large.length) {
    lines.push('', 'Ficheros grandes: busca con grep y lee solo el rango que necesites, no el fichero entero.');
    for (const x of large) lines.push(`- ${x.file} (~${x.lines.toLocaleString('es-ES')} líneas)`);
  }
  if (generated.size) {
    const top = [...generated].filter((g) => ![...generated].some((h) => h !== g && g.startsWith(h))).sort();
    lines.push('', `No leas (generado o dependencias): ${top.join(', ')}`);
  }
  const text = lines.join('\n');
  return { text, block: `${START}\n${text}\n${END}`, tokens: Math.round(text.length / BYTES_PER_TOKEN), files: all.length, large };
}

module.exports = { buildMap, START, END, DEFAULTS };
