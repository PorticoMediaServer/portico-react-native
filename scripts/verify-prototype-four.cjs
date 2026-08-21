#!/usr/bin/env node

/**
 * Prototype 4 is the approved, immutable visual reference for the production app.
 *
 * Normal use verifies the checked-in manifest:
 *   node scripts/verify-prototype-four.cjs
 *
 * `--write` exists only to establish a reviewed baseline. Updating the manifest is
 * not a normal part of production UI work and must never be used to hide changes
 * to the reference tree.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
const referenceRoot = path.join(
  workspaceRoot,
  'packages',
  'app',
  'design-reference',
  'approved-prototype-4',
);
const manifestPath = path.join(
  workspaceRoot,
  'packages',
  'app',
  'src',
  'fidelity',
  'prototype-four.manifest.json',
);

function collectFiles(directory, relativeDirectory = '') {
  const entries = fs.readdirSync(directory, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      throw new Error(`Prototype 4 must not contain symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath, relativePath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Prototype 4 contains an unsupported entry: ${relativePath}`);
    }

    const contents = fs.readFileSync(absolutePath);
    files.push({
      path: relativePath,
      bytes: contents.byteLength,
      sha256: crypto.createHash('sha256').update(contents).digest('hex'),
    });
  }

  return files;
}

function buildManifest() {
  if (!fs.existsSync(referenceRoot)) {
    throw new Error(`Prototype 4 reference tree is missing: ${referenceRoot}`);
  }

  return {
    schemaVersion: 1,
    reference: 'packages/app/design-reference/approved-prototype-4',
    policy: 'immutable-known-good-copy',
    files: collectFiles(referenceRoot),
  };
}

function serialize(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function summarizeChanges(expected, actual) {
  const expectedByPath = new Map(expected.files.map(file => [file.path, file]));
  const actualByPath = new Map(actual.files.map(file => [file.path, file]));
  const added = [...actualByPath.keys()].filter(filePath => !expectedByPath.has(filePath));
  const removed = [...expectedByPath.keys()].filter(filePath => !actualByPath.has(filePath));
  const changed = [...actualByPath.keys()].filter(filePath => {
    const prior = expectedByPath.get(filePath);
    const current = actualByPath.get(filePath);
    return prior && (prior.bytes !== current.bytes || prior.sha256 !== current.sha256);
  });

  return [
    added.length ? `  Added: ${added.join(', ')}` : null,
    removed.length ? `  Removed: ${removed.join(', ')}` : null,
    changed.length ? `  Changed: ${changed.join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

const actual = buildManifest();

if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(manifestPath), {recursive: true});
  fs.writeFileSync(manifestPath, serialize(actual), 'utf8');
  console.log(`Captured Prototype 4 fidelity manifest (${actual.files.length} files).`);
  process.exit(0);
}

if (!fs.existsSync(manifestPath)) {
  console.error('Prototype 4 fidelity manifest is missing. The immutable reference cannot be verified.');
  process.exit(1);
}

let expected;
try {
  expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`Prototype 4 fidelity manifest is invalid: ${error.message}`);
  process.exit(1);
}

if (serialize(expected) !== serialize(actual)) {
  console.error('Prototype 4 changed. Production promotion work must copy from, never edit, the approved reference.');
  const summary = summarizeChanges(expected, actual);
  if (summary) {
    console.error(summary);
  }
  console.error('Restore the reference files. Do not regenerate the manifest to accept production work.');
  process.exit(1);
}

console.log(`Prototype 4 fidelity guard passed (${actual.files.length} immutable files).`);
