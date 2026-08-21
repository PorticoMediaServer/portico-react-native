import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {
  FOUNDATION_ENVELOPE_KEYS,
  RN_BUILD_CONTRACT_KEYS,
  validateContract,
} from './verify-build-contract.mjs';

const rnRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = resolve(rnRoot, '..', '..');
const generator = join(repositoryRoot, 'tools', 'foundation', 'generate.py');
const releaseIdentity = join(repositoryRoot, 'foundation', 'release', 'release-identity.json');
const foundationArtifactPath = join(repositoryRoot, 'foundation', 'generated', 'portico-foundation.generated.json');
const artifactPath = join(rnRoot, 'scripts', 'generated', 'portico-build-contract.generated.json');
const guard = join(rnRoot, 'scripts', 'verify-build-contract.mjs');
const bootstrapSource = join(rnRoot, 'scripts', 'install-build-contract.js');
const exactBuildInputs = [
  'PORTICO_ENVIRONMENT',
  'PORTICO_BUILD_CHANNEL',
  'PORTICO_VERSION',
  'PORTICO_BUILD_NUMBER',
  'PORTICO_BUILD_COMMIT',
  'PORTICO_BUILD_TIMESTAMP',
  'PORTICO_DISTRIBUTION',
  'PORTICO_HOSTED_API_ORIGIN',
];

function buildEnvironment(overrides = {}) {
  const environment = {...process.env};
  for (const name of exactBuildInputs) delete environment[name];
  return {...environment, ...overrides};
}

function run(command, args, environment) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
  });
}

function generateEnvelope(environment) {
  const expression = `
import importlib.util, json
spec = importlib.util.spec_from_file_location('portico_foundation_generator', ${JSON.stringify(generator)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
release = json.load(open(${JSON.stringify(releaseIdentity)}))
print(json.dumps(module.build_rn_contract(module.build(), release), sort_keys=True))
`;
  const result = run('python3', ['-c', expression], environment);
  return result.status === 0 ? JSON.parse(result.stdout) : result;
}

test('Foundation generates the production RN injection and rejects unsafe authority inputs', () => {
  const missingProtectedOrigin = generateEnvelope(buildEnvironment({
    PORTICO_ENVIRONMENT: 'production',
    PORTICO_DISTRIBUTION: 'app-store',
    PORTICO_VERSION: '1.2.3',
    PORTICO_BUILD_NUMBER: '7',
    PORTICO_BUILD_COMMIT: 'a'.repeat(40),
  }));
  assert.notEqual(missingProtectedOrigin.status, 0);
  assert.match(`${missingProtectedOrigin.stdout}${missingProtectedOrigin.stderr}`, /HTTPS origin/);

  const insecureOrigin = generateEnvelope(buildEnvironment({
    PORTICO_ENVIRONMENT: 'development',
    PORTICO_DISTRIBUTION: 'development',
    PORTICO_HOSTED_API_ORIGIN: 'http://localhost:8080',
  }));
  assert.notEqual(insecureOrigin.status, 0);
  assert.match(`${insecureOrigin.stdout}${insecureOrigin.stderr}`, /HTTPS origin/);

  const production = generateEnvelope(buildEnvironment({
    PORTICO_ENVIRONMENT: 'production',
    PORTICO_BUILD_CHANNEL: 'production',
    PORTICO_DISTRIBUTION: 'app-store',
    PORTICO_HOSTED_API_ORIGIN: 'https://api.example.test',
    PORTICO_VERSION: '1.2.3',
    PORTICO_BUILD_NUMBER: '7',
    PORTICO_BUILD_COMMIT: 'a'.repeat(40),
  }));
  assert.deepEqual(production, {
    apiVersion: 'v1',
    appVersion: '1.2.3',
    buildNumber: '7',
    commit: 'a'.repeat(40),
    distribution: 'app-store',
    environment: 'production',
    hostedApiBaseUrl: 'https://api.example.test',
    version: 1,
  });
  assert.deepEqual(Object.keys(production).sort(), [...RN_BUILD_CONTRACT_KEYS].sort());
  for (const field of FOUNDATION_ENVELOPE_KEYS) assert.equal(Object.hasOwn(production, field), false, field);
  assert.doesNotThrow(() => validateContract(production, {
    build: {
      version: '1.2.3',
      buildNumber: '7',
      commit: 'a'.repeat(40),
      channel: 'production',
    },
  }));
  assert.throws(
    () => validateContract({...production, compatibility: {}}, undefined),
    /exact reduced RN build-contract boundary/,
  );

  const temporary = mkdtempSync(join(tmpdir(), 'portico-build-contract-'));
  try {
    const generatedDirectory = join(temporary, 'generated');
    mkdirSync(generatedDirectory, {recursive: true});
    writeFileSync(join(generatedDirectory, 'portico-build-contract.generated.json'), `${JSON.stringify(production)}\n`);
    writeFileSync(join(temporary, 'install-build-contract.js'), readFileSync(bootstrapSource));
    const bootstrap = run(process.execPath, ['-e', `
      require(${JSON.stringify(join(temporary, 'install-build-contract.js'))});
      const value = globalThis.__PORTICO_BUILD_CONTRACT__;
      if (!value || value.hostedApiBaseUrl !== 'https://api.example.test' || value.buildNumber !== '7') process.exit(1);
    `], buildEnvironment());
    assert.equal(bootstrap.status, 0, bootstrap.stderr);
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }

  const sourceGuard = run(process.execPath, [guard, '--json'], buildEnvironment());
  assert.equal(sourceGuard.status, 0, sourceGuard.stderr);
  const first = JSON.parse(sourceGuard.stdout);
  const secondResult = run(process.execPath, [guard, '--json'], buildEnvironment());
  assert.equal(secondResult.status, 0, secondResult.stderr);
  assert.deepEqual(first, JSON.parse(secondResult.stdout));
  assert.equal(first.status, 'source-template-unconfigured');
  const sourceBuildContract = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const sourceFoundation = JSON.parse(readFileSync(foundationArtifactPath, 'utf8'));
  assert.equal(sourceBuildContract.hostedApiBaseUrl, '__PORTICO_REQUIRED_HTTPS_HOSTED_API_ORIGIN__');
  assert.deepEqual(Object.keys(sourceBuildContract).sort(), [...RN_BUILD_CONTRACT_KEYS].sort());
  for (const field of FOUNDATION_ENVELOPE_KEYS) assert.equal(Object.hasOwn(sourceBuildContract, field), false, field);
  assert.equal(sourceBuildContract.appVersion, sourceFoundation.build.version);
  assert.equal(sourceBuildContract.buildNumber, sourceFoundation.build.buildNumber);
  assert.equal(sourceBuildContract.commit, sourceFoundation.build.commit);
  assert.equal(sourceBuildContract.environment, sourceFoundation.build.channel);
  assert.equal(sourceBuildContract.environment, JSON.parse(readFileSync(releaseIdentity, 'utf8')).environment);
  assert.equal(sourceBuildContract.distribution, JSON.parse(readFileSync(releaseIdentity, 'utf8')).channel);

  const checked = run('python3', [generator, '--check'], buildEnvironment());
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});
