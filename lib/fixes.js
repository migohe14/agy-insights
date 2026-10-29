// Ready-to-paste exclusions using only official Antigravity mechanisms. This module never writes
// anything: it builds the exact text and says which file it goes in. Applying it is the developer's call.
const fs = require('fs');
const os = require('os');
const path = require('path');

const AGY_SETTINGS = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');

// Paths as the developer's OS writes them (agy matches permission paths literally).
const native = (p) => (/^[A-Za-z]:\//.test(p) ? p.replace(/\//g, '\\') : p);

let denied = null;
function deniedRules() {
  if (!denied) {
    try { denied = JSON.parse(fs.readFileSync(AGY_SETTINGS, 'utf8')).permissions?.deny || []; } catch { denied = []; }
  }
  return denied;
}

// Permission rule (https://antigravity.google/docs/permissions): deny > ask > allow, a denied read_file
// path covers everything below it, and denying a read also denies writes there.
function deny(absPath) {
  const rule = `read_file(${native(absPath)})`;
  return {
    how: 'deny', title: 'Denegar la lectura (permiso de Antigravity)',
    file: AGY_SETTINGS, where: 'dentro de "permissions" → "deny"',
    text: JSON.stringify(rule),
    note: 'Es lo único que impide la lectura. Afecta a todos tus proyectos, también impide escribir en esa ruta, y hay que reiniciar agy.',
    applied: deniedRules().includes(rule),
  };
}

// .antigravityignore: Antigravity's own exclusion file. Its scope is undocumented; it is confirmed to hide
// files from @ completion, not to stop the agent from reading them.
function ignore(root, patterns) {
  const file = path.join(native(root), '.antigravityignore');
  let current = [];
  try { current = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()); } catch { /* not there yet */ }
  const missing = patterns.filter((p) => !current.includes(p));
  return {
    how: 'ignore', title: 'Añadir a .antigravityignore',
    file, where: 'al final del fichero (créalo si no existe)',
    text: missing.join('\n'),
    note: 'Lo oculta del autocompletado con @; no está documentado que impida leerlo.',
    applied: missing.length === 0,
  };
}

// AGENTS.md rule: a request to the model, sent with every request (it costs tokens too).
function rule(root, text) {
  const file = path.join(native(root), 'AGENTS.md');
  const line = `- ${text}`;
  let present = false;
  try { present = fs.readFileSync(file, 'utf8').split(/\r?\n/).some((l) => l.trim() === line); } catch { /* none */ }
  return {
    how: 'rule', title: 'Añadir una regla a AGENTS.md',
    file, where: 'al final del fichero',
    text: line,
    note: 'Es una indicación al modelo, no un bloqueo. Se envía en cada petición: mantenla corta. AGENTS.md suele estar en el repo del equipo.',
    applied: present,
  };
}

module.exports = { AGY_SETTINGS, native, deny, ignore, rule };
