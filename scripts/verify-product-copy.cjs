#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
const sourceRoots = [
  path.join(workspaceRoot, 'packages', 'app', 'src'),
  path.join(workspaceRoot, 'packages', 'infrastructure', 'src'),
];
const catalog = JSON.parse(
  fs.readFileSync(
    path.resolve(workspaceRoot, '..', 'portico-server', 'api', 'product-language', 'en-US.json'),
    'utf8',
  ),
);
const generatedCatalogSource = fs.readFileSync(
  path.resolve(
    workspaceRoot,
    '..',
    'portico-server',
    'packages',
    'portico-client-core',
    'src',
    'productLanguageCatalog.generated.ts',
  ),
  'utf8',
);
const forbiddenPhrases = [
  'authentication checks succeed',
  'connection diagnostics',
  'downloads couldn’t be read from this iphone',
  'discovered directly on this local network',
  'fixture media',
  'fresh content appears only after',
  'in this build',
  'moving through the app',
  'portico couldn’t prepare this stream',
  'not advertised by this server',
  'securely sign it in',
  'security token is missing',
  'server-defined presentation',
  'server-scoped credentials',
  'the next title couldn’t be prepared',
  'the selected playback option couldn’t be prepared',
  'this stream stopped unexpectedly',
  'this view does not publish',
];

function sourceFiles(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return entry.isFile() && /\.[jt]sx?$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name) ? [absolutePath] : [];
  });
}

const violations = [];
for (const sourceRoot of sourceRoots) {
  for (const filePath of sourceFiles(sourceRoot)) {
    const relativePath = path.relative(workspaceRoot, filePath);
    const rawSource = fs.readFileSync(filePath, 'utf8');
    const source = rawSource.toLowerCase();
    for (const phrase of forbiddenPhrases) {
      if (source.includes(phrase)) {
        violations.push(`${relativePath}: ${phrase}`);
      }
    }
    if (/instanceof\s+Error\s*\?[^:\n]*\.message/.test(rawSource)) {
      violations.push(`${relativePath}: arbitrary Error.message rendered as product copy`);
    }
    if (/\bproductErrorMessage\s*\(/.test(rawSource))
      violations.push(`${relativePath}: failures must use ProductMessageId fallbacks`);
    if (/new\s+ProductError\s*\(/.test(rawSource))
      violations.push(`${relativePath}: local validation must use ProductMessageError`);
    const calls = rawSource.matchAll(
      /(?:productMessage|productMessageText|productErrorMessageId|ProductMessageError)\s*\(\s*['"]([^'"]+)['"]/g,
    );
    for (const match of calls) {
      if (!Object.prototype.hasOwnProperty.call(catalog.messages, match[1]))
        violations.push(`${relativePath}: unknown ProductMessageId ${match[1]}`);
      else if (!generatedCatalogSource.includes(`"${match[1]}"`))
        violations.push(`${relativePath}: ProductMessageId ${match[1]} is missing from generated Client Core types`);
    }
  }
}

if (violations.length) {
  console.error('React Native product copy exposes internal implementation commentary:');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log(`React Native product-copy guard passed (${forbiddenPhrases.length} forbidden phrases).`);
