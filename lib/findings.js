// Turns an analysis report into findings: what context is being sent repeatedly or needlessly, why it
// matters, and which official Antigravity mechanism could address it. Findings only describe and propose
// (see fixes.js); applying anything is always the developer's decision.
const fixes = require('./fixes');
const { repoFiles } = require('./history');
const { t, num, when, kindLabel } = require('./i18n');

const DEFAULTS = { crossSessionMin: 3, heavyOutputTokens: 2000, longSessionTokens: 100000 };

// Suggested .antigravityignore patterns for the built-in non-source types.
const KIND_PATTERNS = {
  'node_modules': ['node_modules/'],
  'build': ['bin/', 'obj/', 'dist/', 'build/', 'out/', 'target/', 'coverage/'],
  'lockfiles': ['*.lock', 'package-lock.json', 'pnpm-lock.yaml', 'packages.lock.json'],
  'logs': ['*.log', '*.map', '*.min.js', '*.min.css'],
  'generated': ['*.designer.cs', '*.g.cs', 'Migrations/'],
};

// A type's patterns for one project, without the build folder names that git keeps in that repo: if
// build/ holds sources there (a webpack config), "build/" must not be proposed for exclusion.
function projectPatterns(root, kind) {
  const files = kind === 'build' ? repoFiles(root) : null;
  if (!files) return KIND_PATTERNS[kind];
  const folders = new Set();
  for (const file of files) for (const part of file.split('/').slice(0, -1)) folders.add(part);
  return KIND_PATTERNS[kind].filter((p) => !(p.endsWith('/') && folders.has(p.slice(0, -1).toLowerCase())));
}

const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const where = (x) => (x.project ? `${x.project} › ${x.rel}` : x.abs);

function findings(r, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const f = t.findings;
  const nonSourceKinds = new Set(r.kinds.filter((k) => k.nonSource).map((k) => k.key));
  const out = [];

  if (r.formatUnrecognized) {
    out.push({ id: 'format', level: 'warn', title: f.formatTitle, why: f.formatWhy(r.steps), suggestion: f.formatSuggestion, items: [] });
  }

  // 1. Same chunk read again within a session: the content is paid twice. The file itself is usually needed.
  const reread = r.files.filter((x) => x.rereads > 0).sort((a, b) => b.rereadTokens - a.rereadTokens);
  if (reread.length) {
    out.push({
      id: 'rereads', level: 'info', title: f.rereadsTitle, tokens: r.rereadTokens,
      why: f.rereadsWhy(r.rereads), suggestion: f.rereadsSuggestion,
      items: reread.slice(0, 10).map((x) => ({ label: where(x), tokens: x.rereadTokens, detail: f.rereads(x.rereads), fixes: [] })),
    });
  }

  // 2. Generated, build output, vendor, lockfiles and logs: rarely needed, and candidates for exclusion.
  const nonSource = r.files.filter((x) => nonSourceKinds.has(x.kind));
  if (nonSource.length) {
    const byFolder = new Map();
    for (const x of nonSource) {
      const abs = x.abs.slice(0, x.abs.lastIndexOf('/'));
      const e = byFolder.get(abs) || { abs, rel: x.rel.slice(0, x.rel.lastIndexOf('/')), root: x.root, project: x.project, kind: x.kind, tokens: 0, calls: 0 };
      e.tokens += x.tokens;
      e.calls += x.calls;
      byFolder.set(abs, e);
    }
    const items = [...byFolder.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10).map((e) => ({
      label: `${where(e)}/`, tokens: e.tokens, detail: `${kindLabel(e.kind)} · ${f.reads(e.calls)}`,
      fixes: [
        fixes.deny(e.abs),
        e.root && fixes.ignore(e.root, [`${e.rel}/`]),
        e.root && fixes.rule(e.root, f.ruleFolder(e.rel, kindLabel(e.kind))),
      ].filter(Boolean),
    }));
    // One pattern-based item per project and type, for folders that have not been read yet.
    const perProject = new Map();
    for (const x of nonSource) {
      if (!x.root || !KIND_PATTERNS[x.kind]) continue;
      const k = `${x.root}|${x.kind}`;
      const e = perProject.get(k) || { root: x.root, project: x.project, kind: x.kind, tokens: 0 };
      e.tokens += x.tokens;
      perProject.set(k, e);
    }
    for (const e of perProject.values()) {
      const patterns = projectPatterns(e.root, e.kind);
      if (!patterns.length) continue;
      items.push({
        label: f.kindPattern(e.project, kindLabel(e.kind)), tokens: e.tokens, detail: f.kindPatternDetail,
        fixes: [
          fixes.ignore(e.root, patterns),
          fixes.rule(e.root, f.ruleKind(kindLabel(e.kind), patterns.join(', '))),
        ],
      });
    }
    out.push({
      id: 'non-source', level: 'warn', title: f.nonSourceTitle, tokens: sum(nonSource, (x) => x.tokens),
      why: f.nonSourceWhy, suggestion: f.nonSourceSuggestion, items,
    });
  }

  // 3. Same file entering many different sessions: repeated context across conversations.
  const cross = r.files.filter((x) => x.convs >= o.crossSessionMin).sort((a, b) => b.tokens - a.tokens);
  if (cross.length) {
    out.push({
      id: 'cross-session', level: 'info', title: f.crossTitle, tokens: sum(cross, (x) => x.tokens),
      why: f.crossWhy(cross.length, o.crossSessionMin), suggestion: f.crossSuggestion,
      // Exclusion is only offered for non-source files: denying core source code would break the agent's work.
      items: cross.slice(0, 10).map((x) => ({
        label: where(x), tokens: x.tokens, detail: `${f.sessions(x.convs)} · ${f.reads(x.calls)}`,
        fixes: nonSourceKinds.has(x.kind) ? [fixes.deny(x.abs), x.root && fixes.ignore(x.root, [x.rel])].filter(Boolean) : [],
      })),
    });
  }

  // 4. Commands whose output is large every time (test suites, builds).
  const heavy = r.commands.filter((c) => c.tokens / c.calls >= o.heavyOutputTokens).sort((a, b) => b.tokens - a.tokens);
  if (heavy.length) {
    out.push({
      id: 'heavy-commands', level: 'warn', title: f.heavyTitle, tokens: sum(heavy, (c) => c.tokens),
      why: f.heavyWhy, suggestion: f.heavySuggestion,
      items: heavy.slice(0, 8).map((c) => ({
        label: c.key, tokens: c.tokens, detail: f.heavyDetail(c.calls, num(c.tokens / c.calls)),
        example: f.heavyExample(c.key), fixes: [],
      })),
    });
  }

  // 5. Very long sessions: everything accumulated is resent on every turn.
  // Real usage when agy's transcript has it (it includes everything resent on each call), else the estimate.
  const size = (s) => (s.usage ? s.usage.input + s.usage.output : s.tokens);
  const long = r.sessions.filter((s) => size(s) >= o.longSessionTokens);
  if (long.length) {
    out.push({
      id: 'long-sessions', level: 'info', title: f.longTitle, tokens: sum(long, (s) => s.tokens),
      why: f.longWhy(long.length, num(o.longSessionTokens)), suggestion: f.longSuggestion,
      items: long.slice(0, 5).map((s) => ({
        // Real tokens when agy logged them (`exact`: shown without "~"), else the size estimate.
        label: f.conversation(s.id.slice(0, 8), when(s.start, s.end)), fixes: [],
        tokens: s.usage ? s.usage.input + s.usage.output : s.tokens, exact: Boolean(s.usage),
        detail: f.steps(s.steps) + (s.usage
          ? f.longUsage(s.usage.calls, num(s.usage.input + s.usage.cache + s.usage.output))
          : ''),
      })),
    });
  }

  return out;
}

module.exports = { findings, DEFAULTS };
