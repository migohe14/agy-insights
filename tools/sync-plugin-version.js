#!/usr/bin/env node
// Run by `npm version` (the "version" script): gives the Antigravity plugin the package's new version, so the
// npm release and the plugin always ship together, in the same commit and tag.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const file = path.join(root, '.antigravity-plugin', 'plugin.json');
const manifest = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, manifest.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`));
