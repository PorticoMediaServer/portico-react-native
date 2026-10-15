#!/usr/bin/env node
// The shared client packages are owned by portico-server (packages/). This repository keeps
// an identical copy of the parts the apps use, so it builds on its own.
//
//   node scripts/shared-packages.mjs --check   # fail if any copied file differs from portico-server
//   node scripts/shared-packages.mjs --write   # replace the copy with portico-server's
//
// PORTICO_SERVER_REPO points at the portico-server checkout (default: ../portico-server).
import {createHash} from 'node:crypto';
import {cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.resolve(process.env.PORTICO_SERVER_REPO ?? path.join(here, '../portico-server'));
const SHARED = {
  'packages/client-core': ['src', 'package.json', 'tsconfig.json'],
  'packages/contracts': ['src', 'package.json'],
  'packages/design': ['src', 'package.json', 'COMPONENTS.md', 'LICENSE-LUCIDE'],
  'packages/i18n': ['src', 'scripts', 'baselines', 'package.json'],
};
const mode = process.argv[2];
if (mode !== '--check' && mode !== '--write') {
  console.error('usage: shared-packages.mjs --check | --write');
  process.exit(2);
}
if (!existsSync(path.join(server, 'packages/client-core'))) {
  console.error(`shared-packages: no portico-server checkout at ${server} (set PORTICO_SERVER_REPO)`);
  process.exit(2);
}
const files = (root, rel) => {
  const full = path.join(root, rel);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [rel];
  return readdirSync(full, {withFileTypes: true})
    .filter(e => e.name !== 'node_modules' && e.name !== '.DS_Store')
    .flatMap(e => files(root, path.join(rel, e.name)));
};
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
let drift = 0;
for (const [pkg, parts] of Object.entries(SHARED)) {
  for (const part of parts) {
    const rel = path.join(pkg, part);
    if (mode === '--write') {
      rmSync(path.join(here, rel), {recursive: true, force: true});
      cpSync(path.join(server, rel), path.join(here, rel), {recursive: true, filter: s => !s.includes('node_modules')});
      continue;
    }
    const ours = new Set(files(here, rel)), theirs = new Set(files(server, rel));
    for (const f of new Set([...ours, ...theirs])) {
      if (!ours.has(f) || !theirs.has(f) || digest(path.join(here, f)) !== digest(path.join(server, f))) {
        console.error(`differs: ${f}`);
        drift++;
      }
    }
  }
}
if (mode === '--check') {
  if (drift) { console.error(`shared-packages: ${drift} file(s) differ from ${server}; run --write`); process.exit(1); }
  console.log('shared-packages: identical to portico-server');
}
