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

const HELP = `Uso: agy-insights [opciones]   (o npx …, o node agy-insights.js)

Analiza tu historial de Antigravity CLI y abre un informe en el navegador.

Opciones:
  --project <carpeta>   Solo conversaciones que tocaron ese proyecto ("." = carpeta actual)
  --text                Resumen en la terminal en vez del informe HTML
  --paths               Con --text, muestra rutas y las exclusiones propuestas
  --map                 Imprime un mapa del proyecto (--project, o la carpeta actual) para AGENTS.md
  --out <fichero>       Dónde guardar el informe HTML (por defecto, en la carpeta temporal)
  --no-open             No abrir el navegador
  --dir <carpeta>       Otra carpeta de historial (por defecto ${DEFAULT_DIR})
  --config <fichero>    Configuración (por defecto ~/.agy-insights.json si existe)
  --help                Esta ayuda
`;

function parseArgs(argv) {
  const opts = { open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) fail(`Falta el valor de ${a}`);
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
    else fail(`Opción desconocida: ${a}. Usa --help.`);
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
    if (file) fail(`No existe el fichero de configuración ${file}`);
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    return fail(`No se puede leer ${target}: ${e.message}`);
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  const cfg = loadConfig(opts.config);

  if (opts.map) opts.project = opts.project || process.cwd();
  const r = await analyze({
    dir: opts.dir || cfg.conversationsDir || DEFAULT_DIR,
    workspaces: opts.project ? [opts.project] : [],
    customKinds: cfg.customKinds || {},
  });
  if (opts.map) {
    const m = buildMap(opts.project, { ...cfg.map, history: r.files });
    console.log(m.block);
    return console.error(`\n~${m.tokens} tokens en cada petición. Pégalo en ${path.join(opts.project, 'AGENTS.md')} si te convence; agy-insights no lo escribe.`);
  }
  const found = findings(r, {
    crossSessionMin: cfg.crossSessionMin ?? DEFAULTS.crossSessionMin,
    heavyOutputTokens: cfg.heavyOutputTokens ?? DEFAULTS.heavyOutputTokens,
    longSessionTokens: cfg.longSessionTokens ?? DEFAULTS.longSessionTokens,
  });

  if (opts.text) return process.stdout.write(report.text(r, found, { scope: opts.project, paths: opts.paths }));

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const out = opts.out || path.join(os.tmpdir(), 'agy-insights', `informe-${stamp}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, report.html(r, found, { scope: opts.project }));
  console.log(`${r.conversations} conversaciones analizadas, ${found.length} hallazgos.\nInforme: ${out}`);
  if (opts.open) openInBrowser(out);
}

main().catch((e) => fail(`Error: ${e.message}`));
