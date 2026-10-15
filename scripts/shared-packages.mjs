#!/usr/bin/env node
// The shared client packages are owned by portico-server (packages/). This repository keeps
// an identical copy of the parts the apps use, so it builds on its own.
//
//   node scripts/shared-packages.mjs --check      # fail if any copied file differs from portico-server
//   node scripts/shared-packages.mjs --write      # replace the copy with portico-server's, and record its revision
//   node scripts/shared-packages.mjs --revision   # print the recorded portico-server revision (CI checks that one out)
//
// PORTICO_SERVER_REPO points at the portico-server checkout (default: ../portico-server).
//
// `packages/portico-server.lock.json` records the exact portico-server commit the copy was taken
// from. CI checks out that commit, never a moving branch, and `--check` then proves the copy is
// that commit's packages byte for byte. `--write` refuses a portico-server checkout whose shared
// packages have uncommitted changes, since no commit would then describe what was copied.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.resolve(process.env.PORTICO_SERVER_REPO ?? path.join(here, '../portico-server'));
const LOCK = path.join(here, 'packages/portico-server.lock.json');
const readLock = () => JSON.parse(readFileSync(LOCK, 'utf8'));
const SHARED = {
  'packages/client-core': ['src', 'package.json', 'tsconfig.json'],
  'packages/contracts': ['src', 'package.json'],
  'packages/design': ['src', 'package.json', 'COMPONENTS.md'],
  'packages/i18n': ['src', 'scripts', 'baselines', 'package.json'],
};
const mode = process.argv[2];
if (mode === '--revision') {
  const {revision} = readLock();
  if (!/^[0-9a-f]{40}$/.test(revision ?? '')) { console.error('shared-packages: the lock names no exact portico-server commit'); process.exit(1); }
  console.log(revision);
  process.exit(0);
}
if (mode !== '--check' && mode !== '--write') {
  console.error('usage: shared-packages.mjs --check | --write | --revision');
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
const git = (...args) => execFileSync('git', ['-C', server, ...args], {encoding: 'utf8'}).trim();
if (mode === '--write') {
  const dirty = git('status', '--porcelain', '--', ...Object.keys(SHARED));
  if (dirty) { console.error(`shared-packages: ${server} has uncommitted changes in its shared packages; commit them first:\n${dirty}`); process.exit(1); }
}
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
if (mode === '--write') {
  const revision = git('rev-parse', 'HEAD');
  writeFileSync(LOCK, JSON.stringify({repository: 'PorticoMediaServer/portico-server', revision, packages: Object.keys(SHARED)}, null, 2) + '\n');
  console.log(`shared-packages: copied from portico-server ${revision}`);
}
if (mode === '--check') {
  if (drift) { console.error(`shared-packages: ${drift} file(s) differ from ${server}; run --write`); process.exit(1); }
  // Where the checkout is a Git one, say whether it is the recorded commit (CI checks that one out).
  let at = '';
  try { at = git('rev-parse', 'HEAD'); } catch { /* not a Git checkout */ }
  const {revision} = readLock();
  if (process.env.CI && at !== revision) { console.error(`shared-packages: portico-server is at ${at || 'an unknown commit'}, the lock records ${revision}`); process.exit(1); }
  console.log(`shared-packages: identical to portico-server${at === revision ? ` ${revision} (the recorded commit)` : ''}`);
}
