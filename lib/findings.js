// Turns an analysis report into findings: what context is being sent repeatedly or needlessly, why it
// matters, and which official Antigravity mechanism could address it. Findings only describe and propose
// (see fixes.js); applying anything is always the developer's decision.
const fixes = require('./fixes');

const DEFAULTS = { crossSessionMin: 3, heavyOutputTokens: 2000, longSessionTokens: 100000 };

// Suggested .antigravityignore patterns for the built-in non-source types.
const KIND_PATTERNS = {
  'node_modules': ['node_modules/'],
  'build output (dist, bin, obj…)': ['bin/', 'obj/', 'dist/', 'build/', 'out/', 'target/', 'coverage/'],
  'lockfiles': ['*.lock', 'package-lock.json', 'pnpm-lock.yaml', 'packages.lock.json'],
  'logs, maps, minificados': ['*.log', '*.map', '*.min.js', '*.min.css'],
  'código generado / migraciones': ['*.designer.cs', '*.g.cs', 'Migrations/'],
};

const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const where = (x) => (x.project ? `${x.project} › ${x.rel}` : x.abs);

function findings(r, opts = {}) {
  const t = { ...DEFAULTS, ...opts };
  const nonSourceKinds = new Set(r.kinds.filter((k) => k.nonSource).map((k) => k.key));
  const out = [];

  if (r.formatUnrecognized) {
    out.push({
      id: 'format', level: 'warn', title: 'No se reconoce el formato del historial',
      why: `Hay ${r.steps} pasos pero ninguna llamada a herramienta reconocible. Probablemente agy ha cambiado cómo guarda las conversaciones.`,
      suggestion: 'Los resultados de abajo no son fiables. Actualiza agy-insights (git pull) o abre una incidencia en el repo.',
      items: [],
    });
  }

  // 1. Same chunk read again within a session: the content is paid twice. The file itself is usually needed.
  const reread = r.files.filter((f) => f.rereads > 0).sort((a, b) => b.rereadTokens - a.rereadTokens);
  if (reread.length) {
    out.push({
      id: 'rereads', level: 'info', title: 'El agente vuelve a leer lo que ya tenía',
      tokens: r.rereadTokens,
      why: `${plural(r.rereads, 'lectura repite', 'lecturas repiten')} un trozo que ya se había leído en la misma sesión. Ese contenido entra dos veces en el contexto.`,
      suggestion: 'Suele pasar en sesiones largas o después de editar. Sesiones más cortas por tarea, o /compact, lo reducen. No conviene excluir estos ficheros: el agente los necesita.',
      items: reread.slice(0, 10).map((f) => ({ label: where(f), tokens: f.rereadTokens, detail: plural(f.rereads, 'relectura', 'relecturas'), fixes: [] })),
    });
  }

  // 2. Generated, build output, vendor, lockfiles and logs: rarely needed, and candidates for exclusion.
  const nonSource = r.files.filter((f) => nonSourceKinds.has(f.kind));
  if (nonSource.length) {
    const byFolder = new Map();
    for (const f of nonSource) {
      const abs = f.abs.slice(0, f.abs.lastIndexOf('/'));
      const e = byFolder.get(abs) || { abs, rel: f.rel.slice(0, f.rel.lastIndexOf('/')), root: f.root, project: f.project, kind: f.kind, tokens: 0, calls: 0 };
      e.tokens += f.tokens;
      e.calls += f.calls;
      byFolder.set(abs, e);
    }
    const items = [...byFolder.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10).map((e) => ({
      label: `${where(e)}/`, tokens: e.tokens, detail: `${e.kind} · ${plural(e.calls, 'lectura', 'lecturas')}`,
      fixes: [
        fixes.deny(e.abs),
        e.root && fixes.ignore(e.root, [`${e.rel}/`]),
        e.root && fixes.rule(e.root, `No leas \`${e.rel}/\`: es ${e.kind}; trabaja con el código fuente.`),
      ].filter(Boolean),
    }));
    // One pattern-based item per project and type, for folders that have not been read yet.
    const perProject = new Map();
    for (const f of nonSource) {
      if (!f.root || !KIND_PATTERNS[f.kind]) continue;
      const k = `${f.root}|${f.kind}`;
      const e = perProject.get(k) || { root: f.root, project: f.project, kind: f.kind, tokens: 0 };
      e.tokens += f.tokens;
      perProject.set(k, e);
    }
    for (const e of perProject.values()) {
      items.push({
        label: `${e.project} › todo lo de tipo «${e.kind}»`, tokens: e.tokens, detail: 'patrón para cualquier carpeta del proyecto',
        fixes: [
          fixes.ignore(e.root, KIND_PATTERNS[e.kind]),
          fixes.rule(e.root, `No leas ${e.kind} (${KIND_PATTERNS[e.kind].join(', ')}) salvo que la tarea lo pida.`),
        ],
      });
    }
    out.push({
      id: 'non-source', level: 'warn', title: 'Se leen ficheros generados, compilados o de dependencias',
      tokens: sum(nonSource, (f) => f.tokens),
      why: 'Salidas de build, código generado, dependencias, lockfiles y logs casi nunca hacen falta para entender o cambiar el código, y suelen ser grandes.',
      suggestion: 'Revisa si alguna de estas lecturas era necesaria. Si no, puedes impedirlas con un permiso de Antigravity.',
      items,
    });
  }

  // 3. Same file entering many different sessions: repeated context across conversations.
  const cross = r.files.filter((f) => f.convs >= t.crossSessionMin).sort((a, b) => b.tokens - a.tokens);
  if (cross.length) {
    out.push({
      id: 'cross-session', level: 'info', title: 'Los mismos ficheros entran en muchas sesiones',
      tokens: sum(cross, (f) => f.tokens),
      why: `${plural(cross.length, 'fichero se ha leído', 'ficheros se han leído')} en ${t.crossSessionMin} o más conversaciones distintas.`,
      suggestion: 'Si son el núcleo del proyecto es normal. Si son grandes y el agente solo necesita una parte, decirle qué trozo mirar ahorra lecturas.',
      // Exclusion is only offered for non-source files: denying core source code would break the agent's work.
      items: cross.slice(0, 10).map((f) => ({
        label: where(f), tokens: f.tokens, detail: `${plural(f.convs, 'sesión', 'sesiones')} · ${plural(f.calls, 'lectura', 'lecturas')}`,
        fixes: nonSourceKinds.has(f.kind) ? [fixes.deny(f.abs), f.root && fixes.ignore(f.root, [f.rel])].filter(Boolean) : [],
      })),
    });
  }

  // 4. Commands whose output is large every time (test suites, builds).
  const heavy = r.commands.filter((c) => c.tokens / c.calls >= t.heavyOutputTokens).sort((a, b) => b.tokens - a.tokens);
  if (heavy.length) {
    out.push({
      id: 'heavy-commands', level: 'warn', title: 'Comandos con salidas muy largas',
      tokens: sum(heavy, (c) => c.tokens),
      why: 'La salida completa de cada comando entra en el contexto y se reenvía en los turnos siguientes.',
      suggestion: 'Pide ejecutar solo lo necesario (un test concreto, un proyecto concreto) o filtrar la salida. Si pasa siempre, una regla en el AGENTS.md del proyecto lo recuerda en cada sesión.',
      items: heavy.slice(0, 8).map((c) => ({
        label: c.key, tokens: c.tokens, detail: `${plural(c.calls, 'vez', 'veces')} · ~${Math.round(c.tokens / c.calls).toLocaleString('es-ES')} tokens cada una`,
        example: `- Al ejecutar \`${c.key}\`, limita la salida: solo el test o proyecto afectado, o filtra las líneas relevantes.`,
        fixes: [],
      })),
    });
  }

  // 5. Very long sessions: everything accumulated is resent on every turn.
  // Real usage when agy's transcript has it (it includes everything resent on each call), else the estimate.
  const size = (s) => (s.usage ? s.usage.input + s.usage.output : s.tokens);
  const long = r.sessions.filter((s) => size(s) >= t.longSessionTokens);
  if (long.length) {
    out.push({
      id: 'long-sessions', level: 'info', title: 'Sesiones muy largas',
      tokens: sum(long, (s) => s.tokens),
      why: `${plural(long.length, 'conversación supera', 'conversaciones superan')} ${t.longSessionTokens.toLocaleString('es-ES')} tokens. En una sesión larga, todo lo acumulado se vuelve a enviar en cada turno.`,
      suggestion: 'Una conversación nueva por tarea, o /compact cuando cambias de tema.',
      items: long.slice(0, 5).map((s) => ({
        label: `conversación ${s.id.slice(0, 8)}`, tokens: s.tokens, fixes: [],
        detail: plural(s.steps, 'paso', 'pasos') + (s.usage
          ? ` · ${s.usage.calls} llamadas al modelo, ${(s.usage.input + s.usage.output).toLocaleString('es-ES')} tokens reales (${(s.usage.input + s.usage.cache + s.usage.output).toLocaleString('es-ES')} con caché)`
          : ''),
      })),
    });
  }

  return out;
}

module.exports = { findings, DEFAULTS };
