#!/usr/bin/env node

import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(root, '..', '..');
const artifactPath = join(root, 'scripts', 'generated', 'portico-build-contract.generated.json');
const foundationArtifactPath = join(repositoryRoot, 'foundation', 'generated', 'portico-foundation.generated.json');
const bootstrapPath = join(root, 'scripts', 'install-build-contract.js');
const entrypoints = [
  join(root, 'apps', 'apple-mobile', 'index.js'),
  join(root, 'apps', 'apple-tv', 'index.js'),
];
const REQUIRED_HOSTED_ORIGIN = '__PORTICO_REQUIRED_HTTPS_HOSTED_API_ORIGIN__';
const ENVIRONMENTS = new Set(['development', 'test', 'staging', 'production']);
const DISTRIBUTIONS = new Set(['development', 'simulator', 'testflight', 'app-store', 'enterprise']);
/**
 * P09/RN boundary: Metro receives only the routing and build-identity projection
 * needed before the application starts. Foundation compatibility, API, platform,
 * recovery, and action semantics remain in the full Foundation envelope and are
 * deliberately not copied into this global.
 */
export const RN_BUILD_CONTRACT_KEYS = Object.freeze([
  'version',
  'apiVersion',
  'environment',
  'distribution',
  'hostedApiBaseUrl',
  'appVersion',
  'buildNumber',
  'commit',
]);
export const FOUNDATION_ENVELOPE_KEYS = Object.freeze([
  '$schema',
  'build',
  'compatibility',
  'environments',
  'externalActions',
  'forwardCompatibility',
  'platform',
  'recoveryActions',
  'schemaRevision',
]);

function fail(message) {
  throw new Error(`RN build-contract guard: ${message}`);
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function boundedString(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value.trim() !== value || /\s/.test(value)) {
    fail(`${field} must be a bounded non-empty value without whitespace`);
  }
}

function isHttpsOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname.length > 0
      && url.username === ''
      && url.password === ''
      && url.pathname === '/'
      && url.search === ''
      && url.hash === '';
  } catch {
    return false;
  }
}

function validateReducedBoundary(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) fail('artifact is not an object');
  const keys = Object.keys(contract).sort();
  if (keys.join('|') !== [...RN_BUILD_CONTRACT_KEYS].sort().join('|')) fail('artifact fields are not the exact reduced RN build-contract boundary');
  if (FOUNDATION_ENVELOPE_KEYS.some(field => Object.hasOwn(contract, field))) {
    fail('artifact copies fields from the full Foundation envelope');
  }
}

function validateFoundationAlignment(contract, foundation) {
  if (!foundation || typeof foundation !== 'object' || Array.isArray(foundation) || !foundation.build || typeof foundation.build !== 'object') {
    fail('Foundation artifact is missing its build identity');
  }
  const alignedFields = [
    ['appVersion', foundation.build.version],
    ['buildNumber', foundation.build.buildNumber],
    ['commit', foundation.build.commit],
    ['environment', foundation.build.channel],
  ];
  for (const [field, expected] of alignedFields) {
    if (contract[field] !== expected) fail(`${field} is not aligned with the Foundation build identity`);
  }
}

export function validateContract(contract, foundation) {
  validateReducedBoundary(contract);
  if (foundation !== undefined) validateFoundationAlignment(contract, foundation);
  if (contract.version !== 1 || contract.apiVersion !== 'v1') fail('envelope revision or API version is unsupported');
  if (!ENVIRONMENTS.has(contract.environment)) fail('environment is invalid');
  if (!DISTRIBUTIONS.has(contract.distribution)) fail('distribution is invalid');
  if (contract.hostedApiBaseUrl !== REQUIRED_HOSTED_ORIGIN && !isHttpsOrigin(contract.hostedApiBaseUrl)) {
    fail('Hosted authority must be an HTTPS origin');
  }
  boundedString(contract.appVersion, 'appVersion');
  boundedString(contract.buildNumber, 'buildNumber');
  boundedString(contract.commit, 'commit');
  if (contract.environment === 'production' || contract.environment === 'staging') {
    if (contract.hostedApiBaseUrl === REQUIRED_HOSTED_ORIGIN) fail('protected builds cannot use an unconfigured Hosted authority');
    if (contract.distribution === 'development' || contract.distribution === 'simulator') fail('protected builds cannot use a development distribution');
    if (contract.commit === 'UNSTAMPED_DEVELOPMENT' || contract.buildNumber === '0') fail('protected builds require release build identity');
  }
  return contract;
}

export function validateBootstrap() {
  const bootstrap = readFileSync(bootstrapPath, 'utf8');
  if (!bootstrap.includes("portico-build-contract.generated.json")) fail('bootstrap does not consume the generated artifact');
  if (!bootstrap.includes("__PORTICO_BUILD_CONTRACT__")) fail('bootstrap does not publish the canonical global');
  if (/https?:\/\//i.test(bootstrap)) fail('bootstrap contains a source URL fallback');
  for (const entrypoint of entrypoints) {
    const source = readFileSync(entrypoint, 'utf8');
    const bootstrapImport = source.indexOf("import '../../scripts/install-build-contract';");
    const gestureImport = source.indexOf("import 'react-native-gesture-handler';");
    const appImport = source.indexOf("import App from './App';");
    if (bootstrapImport < 0 || gestureImport < 0 || appImport < 0 || bootstrapImport > gestureImport || bootstrapImport > appImport) {
      fail(`${entrypoint} does not install the build contract before app imports`);
    }
  }
}

function main() {
  const foundation = existsSync(foundationArtifactPath) ? readJSON(foundationArtifactPath) : undefined;
  const contract = validateContract(readJSON(artifactPath), foundation);
  validateBootstrap();
  const evidence = {
    status: contract.hostedApiBaseUrl === REQUIRED_HOSTED_ORIGIN ? 'source-template-unconfigured' : 'generated-build-contract',
    artifact: 'scripts/generated/portico-build-contract.generated.json',
    boundary: 'reduced-build-identity-and-routing',
    environment: contract.environment,
    distribution: contract.distribution,
    hostedApiAuthority: contract.hostedApiBaseUrl === REQUIRED_HOSTED_ORIGIN ? 'pending-explicit-https-build-input' : 'explicit-https-origin',
    buildIdentity: {
      appVersion: contract.appVersion,
      buildNumber: contract.buildNumber,
      commit: contract.commit,
    },
  };
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } else {
    process.stdout.write(`RN build-contract guard: ${evidence.status}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
