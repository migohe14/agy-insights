// Ready-to-paste exclusions using only official Antigravity mechanisms. This module never writes
// anything: it builds the exact text and says which file it goes in. Applying it is the developer's call.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { t } = require('./i18n');
const { isAgentFile } = require('./history');

const norm = (p) => p.replace(/[\\/]+/g, '/');

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
// The CLI reads its rules from ~/.gemini/antigravity-cli/settings.json. The IDE, the app and the editor
// extensions have no such file: their rules are set in their Settings, under Permission Grants. So the
// proposal follows `origins`, the Antigravity that read the path ('cli', 'editor'; null or none: the CLI's).
// Antigravity's own files (~/.gemini, its extensions) are never proposed: it needs them to work.
function deny(absPath, origins = ['cli']) {
  if (isAgentFile(norm(absPath))) return [];
  const rule = `read_file(${native(absPath)})`;
  const out = [];
  if (!origins.length || origins.some((o) => o !== 'editor')) {
    out.push({
      how: 'deny', title: t.fixes.denyTitle,
      file: AGY_SETTINGS, where: t.fixes.denyWhere,
      text: JSON.stringify(rule),
      note: t.fixes.denyNote,
      applied: deniedRules().includes(rule),
    });
  }
  if (origins.includes('editor')) {
    out.push({
      how: 'deny-editor', title: t.fixes.denyEditorTitle,
      file: t.fixes.denyEditorPlace, where: t.fixes.denyEditorWhere,
      text: rule,
      note: t.fixes.denyEditorNote,
      applied: false,
    });
  }
  return out;
}

// .antigravityignore: Antigravity's own exclusion file. Its scope is undocumented; it is confirmed to hide
// files from @ completion, not to stop the agent from reading them.
function ignore(root, patterns) {
  const file = path.join(native(root), '.antigravityignore');
  let current = [];
  try { current = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()); } catch { /* not there yet */ }
  const missing = patterns.filter((p) => !current.includes(p));
  return {
    how: 'ignore', title: t.fixes.ignoreTitle,
    file, where: t.fixes.ignoreWhere,
    text: missing.join('\n'),
    note: t.fixes.ignoreNote,
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
    how: 'rule', title: t.fixes.ruleTitle,
    file, where: t.fixes.ruleWhere,
    text: line,
    note: t.fixes.ruleNote,
    applied: present,
  };
}

module.exports = { AGY_SETTINGS, native, deny, ignore, rule };
