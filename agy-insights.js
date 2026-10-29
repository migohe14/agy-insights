#!/usr/bin/env node
// agy-insights: shows which context is sent to Antigravity repeatedly or needlessly, from the local
// Antigravity CLI history. Read-only: the only file it writes is the HTML report, in the temp folder
// (or wherever --out says).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { analyze, DEFAULT_DIR } = require('./lib/history');
const { findings, DEFAULTS } = require('./lib/findings');
const report = require('./lib/report');
const { buildMap } = require('./lib/map');
const { t, setLang, detect } = require('./lib/i18n');

function parseArgs(argv) {
  const opts = { open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) fail(t.missingValue(a));
      return argv[++i];
    };
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--project') opts.project = absolute(value());
    else if (a === '--text') opts.text = true;
    else if (a === '--paths') opts.paths = true;
    else if (a === '--map') opts.map = true;
    else if (a === '--out') opts.out = path.resolve(value());
    else if (a === '--no-open') opts.open = false;
    else if (a === '--dir') opts.dir = path.resolve(value());
    else if (a === '--config') opts.config = path.resolve(value());
    else if (a === '--lang') opts.lang = value();
    else if (a === '--since') opts.since = value();
    else if (a === '--days') opts.days = value();
    else fail(t.unknownOption(a));
  }
  return opts;
}

// History paths may come from Windows ("C:\..."): keep those as they are on any OS.
const absolute = (p) => (/^[A-Za-z]:[\\/]/.test(p) ? p : path.resolve(p));

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function loadConfig(file) {
  const target = file || path.join(os.homedir(), '.agy-insights.json');
  if (!fs.existsSync(target)) {
    if (file) fail(t.configNotFound(file));
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    return fail(t.cannotRead(target, e.message));
  }
}

function openInBrowser(file) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', file]]
    : ['xdg-open', [file]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
  } catch { /* the path is printed anyway */ }
}

// --since YYYY-MM-DD (local midnight) or --days n (n days back from now), as a time in ms; null for all.
function sinceTime({ since, days }) {
  if (since) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since);
    const d = m && new Date(+m[1], m[2] - 1, +m[3]);
    if (!d || d.getMonth() !== m[2] - 1) fail(t.badDate(since));
    return d.getTime();
  }
  if (days !== undefined) {
    if (!/^\d+$/.test(days)) fail(t.badDays(days));
    return Date.now() - Number(days) * 24 * 60 * 60 * 1000;
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  // Language first, so that option errors are already in it.
  if (!(argv.includes('--lang') && setLang(argv[argv.indexOf('--lang') + 1]))) setLang(detect());
  const opts = parseArgs(argv);
  if (opts.lang && !setLang(opts.lang)) fail(t.badLang(opts.lang));
  if (opts.help) return console.log(t.help(DEFAULT_DIR));
  const cfg = loadConfig(opts.config);
  if (!opts.lang && cfg.lang && !setLang(cfg.lang)) fail(t.badLang(cfg.lang));

  if (opts.map) opts.project = opts.project || process.cwd();
  const r = await analyze({
    since: sinceTime(opts),
    dir: opts.dir || cfg.conversationsDir || DEFAULT_DIR,
    workspaces: opts.project ? [opts.project] : [],
    customKinds: cfg.customKinds || {},
  });
  if (opts.map) {
    const m = buildMap(opts.project, { ...cfg.map, history: r.files });
    console.log(m.block);
    return console.error(t.mapDone(m.tokens, path.join(opts.project, 'AGENTS.md')));
  }
  const found = findings(r, {
    crossSessionMin: cfg.crossSessionMin ?? DEFAULTS.crossSessionMin,
    heavyOutputTokens: cfg.heavyOutputTokens ?? DEFAULTS.heavyOutputTokens,
    longSessionTokens: cfg.longSessionTokens ?? DEFAULTS.longSessionTokens,
  });

  if (opts.text) return process.stdout.write(report.text(r, found, { scope: opts.project, paths: opts.paths }));

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const out = opts.out || path.join(os.tmpdir(), 'agy-insights', `${t.reportName}-${stamp}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, report.html(r, found, { scope: opts.project }));
  console.log(t.done(r.conversations, found.length, out));
  if (opts.open) openInBrowser(out);
}

main().catch((e) => fail(`Error: ${e.message}`));
