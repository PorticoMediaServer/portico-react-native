#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const defaultFixturePath = resolve(scriptDirectory, "native-acceptance-matrix.json");

const REQUIRED_CASES = Object.freeze([
  ["RN-009", "clean-install-auth-device-setup"],
  ["RN-009", "zero-servers"],
  ["RN-009", "one-server"],
  ["RN-009", "many-servers"],
  ["RN-009", "zero-profiles"],
  ["RN-009", "one-profile"],
  ["RN-009", "many-profiles"],
  ["RN-009", "pin-and-revocation"],
  ["RN-009", "process-death-credential-publication"],
  ["RN-009", "process-death-viewer-publication"],
  ["RN-009", "offline-lan-recovery"],
  ["RN-009", "token-expiry"],
  ["RN-009", "route-expiry"],
  ["RN-010", "direct-playback"],
  ["RN-010", "hls-playback"],
  ["RN-010", "live-playback"],
  ["RN-010", "dvr-playback"],
  ["RN-010", "seek"],
  ["RN-010", "resume"],
  ["RN-010", "progress"],
  ["RN-010", "tracks"],
  ["RN-010", "grant-renewal"],
  ["RN-012", "tvos-focus"],
  ["RN-012", "tvos-remote"],
  ["RN-012", "tvos-modal"],
  ["RN-012", "tvos-voiceover"],
  ["RN-012", "android-tv-focus"],
  ["RN-012", "android-tv-remote"],
  ["RN-012", "android-tv-modal"],
  ["RN-012", "android-tv-accessibility"],
  ["RN-012", "fire-tv-focus"],
  ["RN-012", "fire-tv-remote"],
  ["RN-012", "fire-tv-modal"],
  ["RN-012", "fire-tv-accessibility"],
].map(([requirement, scenario]) => Object.freeze({
  id: `${requirement}-${scenario}`,
  requirement,
  scenario,
})));

const REQUIRED_EXTERNAL_CASES = Object.freeze([
  Object.freeze({id: "EXT-ios-runtime-acceptance", execution: "physical-device"}),
  Object.freeze({id: "EXT-tvos-runtime-focus-acceptance", execution: "physical-device"}),
  Object.freeze({id: "EXT-android-mobile-runtime-acceptance", execution: "physical-device"}),
  Object.freeze({id: "EXT-android-tv-runtime-focus-acceptance", execution: "physical-device"}),
  Object.freeze({id: "EXT-fire-tv-runtime-focus-acceptance", execution: "physical-device"}),
  Object.freeze({id: "EXT-lan-recovery", execution: "physical-network"}),
  Object.freeze({id: "EXT-provider-backed-playback", execution: "provider-backed"}),
]);

const TOP_LEVEL_KEYS = ["kind", "version", "program", "requirements", "platforms", "execution", "cases", "externalCases"];
const CASE_KEYS = ["id", "requirement", "surface", "scenario", "platforms", "status", "sourceRefs", "assertions"];
const EXTERNAL_CASE_KEYS = ["id", "platforms", "surface", "scenario", "execution", "status", "notRun", "providerCredentials", "reason", "requires"];
const REQUIREMENTS = new Set(["RN-009", "RN-010", "RN-012"]);
const PLATFORM_ORDER = Object.freeze(["ios", "tvos", "android", "android_tv", "fire_tv"]);
const PLATFORMS = new Set(PLATFORM_ORDER);
const PLATFORM_KEYS = ["id", "family", "formFactor", "playerAuthority", "sourceStatus", "runtimeStatus"];
const PLATFORM_BY_ID = new Map([
  ["ios", Object.freeze({id: "ios", family: "apple", formFactor: "mobile", playerAuthority: "avkit"})],
  ["tvos", Object.freeze({id: "tvos", family: "apple", formFactor: "television", playerAuthority: "avkit"})],
  ["android", Object.freeze({id: "android", family: "android", formFactor: "mobile", playerAuthority: "media3"})],
  ["android_tv", Object.freeze({id: "android_tv", family: "android", formFactor: "television", playerAuthority: "media3"})],
  ["fire_tv", Object.freeze({id: "fire_tv", family: "android", formFactor: "television", playerAuthority: "fire-tv"})],
]);
const ALL_CLIENT_PLATFORMS = Object.freeze([...PLATFORM_ORDER]);
const TV_PLATFORMS = Object.freeze(["tvos", "android_tv", "fire_tv"]);
const SURFACES = new Set(["setup", "playback", "tvos", "tv"]);
const EXTERNAL_SURFACES = new Set(["runtime", "network", "provider"]);
const EXTERNAL_EXECUTIONS = new Set(["physical-device", "physical-network", "provider-backed"]);
const SOURCE_ONLY_STATUS = "source-only";
const PENDING_EXTERNAL_STATUS = "pending-external";

function fail(message) {
  throw new Error(`native acceptance matrix: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    fail(`${label} has unknown or missing fields; expected ${allowed.join(",")}`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value;
}

function stringArray(value, label, {allowEmpty = false} = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    fail(`${label} must be a ${allowEmpty ? "possibly empty" : "non-empty"} string array`);
  }
  return value;
}

function orderedUniqueArray(value, allowed, label, {allowEmpty = false} = {}) {
  stringArray(value, label, {allowEmpty});
  if (new Set(value).size !== value.length) fail(`${label} must not repeat entries`);
  if (value.some((item) => !allowed.has(item))) fail(`${label} contains an unknown entry`);
  const expectedOrder = [...value].sort((left, right) => PLATFORM_ORDER.indexOf(left) - PLATFORM_ORDER.indexOf(right));
  if (value.some((item, index) => item !== expectedOrder[index])) fail(`${label} must use canonical platform order`);
  return value;
}

function assertNoSecrets(value, label) {
  if (typeof value === "string" && /(-----BEGIN|Bearer\s+|access_token\s*=|media_grant\s*=|password\s*[:=]|secret\s*[:=])/i.test(value)) {
    fail(`${label} contains credential material`);
  }
}

function validateSourceRef(path, label) {
  nonEmptyString(path, label);
  const absolutePath = resolve(repositoryRoot, path);
  const relativePath = relative(repositoryRoot, absolutePath);
  if (isAbsolute(path) || path.includes("\\") || path.split("/").includes("..") || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith("../")) {
    fail(`${label} must be a repository-relative path without traversal`);
  }
  assertNoSecrets(path, label);
}

export function validateAcceptanceMatrix(matrix) {
  if (!isRecord(matrix)) fail("fixture root must be an object");
  exactKeys(matrix, TOP_LEVEL_KEYS, "fixture root");
  if (matrix.kind !== "portico.native-acceptance-matrix" || matrix.version !== 2 || matrix.program !== "P07") {
    fail("fixture identity/version is unknown");
  }
  const requiredRequirements = ["RN-009", "RN-010", "RN-012"];
  if (!Array.isArray(matrix.requirements) || matrix.requirements.length !== requiredRequirements.length || matrix.requirements.some((item, index) => item !== requiredRequirements[index] || !REQUIREMENTS.has(item))) {
    fail("requirements must be exactly RN-009, RN-010, and RN-012");
  }
  if (new Set(matrix.requirements).size !== matrix.requirements.length) fail("requirements must not repeat");

  if (!Array.isArray(matrix.platforms) || matrix.platforms.length !== PLATFORM_ORDER.length) fail(`platforms must contain exactly ${PLATFORM_ORDER.length} known client platforms`);
  const platformsById = new Map();
  for (const [index, item] of matrix.platforms.entries()) {
    const label = `platform ${index}`;
    if (!isRecord(item)) fail(`${label} must be an object`);
    exactKeys(item, PLATFORM_KEYS, label);
    const expectedId = PLATFORM_ORDER[index];
    if (item.id !== expectedId) fail(`${label} must be ${expectedId} in canonical order`);
    if (platformsById.has(item.id)) fail(`duplicate platform id ${item.id}`);
    platformsById.set(item.id, item);
    const expected = PLATFORM_BY_ID.get(item.id);
    if (!expected || item.family !== expected.family || item.formFactor !== expected.formFactor || item.playerAuthority !== expected.playerAuthority) {
      fail(`${label} has an unknown or mismatched platform identity`);
    }
    if (item.sourceStatus !== SOURCE_ONLY_STATUS || item.runtimeStatus !== "pending-runtime") {
      fail(`${item.id} must be source-only with pending runtime status`);
    }
  }

  const executionKeys = ["mode", "deterministic", "sourceAssertionsExecuted", "sourceHashesComputed", "deviceRun", "simulatorRun", "emulatorRun", "networkRun", "providerCredentials", "runtimeStatus", "claim"];
  if (!isRecord(matrix.execution)) fail("execution must be an object");
  exactKeys(matrix.execution, executionKeys, "execution");
  if (matrix.execution.mode !== "source-only" || matrix.execution.deterministic !== true || matrix.execution.sourceAssertionsExecuted !== false || matrix.execution.sourceHashesComputed !== true || matrix.execution.deviceRun !== false || matrix.execution.simulatorRun !== false || matrix.execution.emulatorRun !== false || matrix.execution.networkRun !== false || matrix.execution.providerCredentials !== "not-supplied" || matrix.execution.runtimeStatus !== "not-run" || matrix.execution.claim !== "source-evidence-only") {
    fail("execution must be deterministic source-only with no source assertion, device, simulator, emulator, network, or provider execution");
  }

  if (!Array.isArray(matrix.cases) || matrix.cases.length !== REQUIRED_CASES.length) fail(`cases must contain exactly ${REQUIRED_CASES.length} known cases`);
  const casesById = new Map();
  const coverageByRequirement = new Map([...REQUIREMENTS].map((requirement) => [requirement, new Set()]));
  for (const [index, item] of matrix.cases.entries()) {
    const label = `case ${index}`;
    if (!isRecord(item)) fail(`${label} must be an object`);
    exactKeys(item, CASE_KEYS, label);
    nonEmptyString(item.id, `${label}.id`);
    if (casesById.has(item.id)) fail(`duplicate case id ${item.id}`);
    casesById.set(item.id, item);
    const expected = REQUIRED_CASES.find((candidate) => candidate.id === item.id);
    if (!expected) fail(`unknown case ${item.id}`);
    if (item.id !== REQUIRED_CASES[index].id) fail(`${item.id} is out of canonical case order`);
    if (item.requirement !== expected.requirement || item.scenario !== expected.scenario || !REQUIREMENTS.has(item.requirement)) fail(`${item.id} has an unknown requirement/scenario mapping`);
    if (!SURFACES.has(item.surface)) fail(`${item.id} has an unknown surface`);
    orderedUniqueArray(item.platforms, PLATFORMS, `${item.id}.platforms`);
    if (item.status !== SOURCE_ONLY_STATUS) fail(`${item.id} must have source-only status`);
    for (const platform of item.platforms) coverageByRequirement.get(item.requirement).add(platform);
    stringArray(item.sourceRefs, `${item.id}.sourceRefs`);
    for (const [refIndex, sourceRef] of item.sourceRefs.entries()) validateSourceRef(sourceRef, `${item.id}.sourceRefs[${refIndex}]`);
    stringArray(item.assertions, `${item.id}.assertions`);
    item.assertions.forEach((assertion, assertionIndex) => assertNoSecrets(assertion, `${item.id}.assertions[${assertionIndex}]`));
  }
  for (const expected of REQUIRED_CASES) if (!casesById.has(expected.id)) fail(`missing required case ${expected.id}`);
  for (const requirement of ["RN-009", "RN-010"]) {
    const coverage = coverageByRequirement.get(requirement);
    if (ALL_CLIENT_PLATFORMS.some((platform) => !coverage.has(platform))) fail(`${requirement} must inventory every client platform`);
  }
  if (TV_PLATFORMS.some((platform) => !coverageByRequirement.get("RN-012").has(platform))) fail("RN-012 must inventory every TV platform");

  if (!Array.isArray(matrix.externalCases) || matrix.externalCases.length !== REQUIRED_EXTERNAL_CASES.length) fail(`externalCases must contain exactly ${REQUIRED_EXTERNAL_CASES.length} known pending cases`);
  const externalById = new Map();
  for (const [index, item] of matrix.externalCases.entries()) {
    const label = `external case ${index}`;
    if (!isRecord(item)) fail(`${label} must be an object`);
    exactKeys(item, EXTERNAL_CASE_KEYS, label);
    nonEmptyString(item.id, `${label}.id`);
    if (externalById.has(item.id)) fail(`duplicate external case id ${item.id}`);
    externalById.set(item.id, item);
    const expected = REQUIRED_EXTERNAL_CASES.find((candidate) => candidate.id === item.id);
    if (!expected || item.execution !== expected.execution) fail(`unknown external case ${item.id}`);
    if (item.id !== REQUIRED_EXTERNAL_CASES[index].id) fail(`${item.id} is out of canonical external case order`);
    orderedUniqueArray(item.platforms, PLATFORMS, `${item.id}.platforms`);
    if (!EXTERNAL_SURFACES.has(item.surface) || !EXTERNAL_EXECUTIONS.has(item.execution)) fail(`${item.id} has an unknown external surface or execution`);
    if (item.status !== PENDING_EXTERNAL_STATUS || item.notRun !== true || item.providerCredentials !== "not-supplied") fail(`${item.id} must remain an explicit pending external case without credentials`);
    nonEmptyString(item.reason, `${item.id}.reason`);
    stringArray(item.requires, `${item.id}.requires`);
    assertNoSecrets(item.reason, `${item.id}.reason`);
    item.requires.forEach((requirement, requirementIndex) => assertNoSecrets(requirement, `${item.id}.requires[${requirementIndex}]`));
  }
  for (const expected of REQUIRED_EXTERNAL_CASES) if (!externalById.has(expected.id)) fail(`missing required external case ${expected.id}`);
  return matrix;
}

function sourceEvidence(root, matrix) {
  const evidence = [];
  for (const item of matrix.cases) {
    for (const path of item.sourceRefs) {
      const absolute = resolve(root, path);
      let metadata;
      try {
        metadata = lstatSync(absolute);
      } catch (error) {
        fail(`${item.id} source reference is unreadable: ${path} (${error.message})`);
      }
      if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${item.id} source reference is not a regular file: ${path}`);
      const bytes = readFileSync(absolute);
      evidence.push({caseId: item.id, path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")});
    }
  }
  return evidence;
}

export function buildSourceOnlyEvidence({root = repositoryRoot, matrix} = {}) {
  const validated = validateAcceptanceMatrix(matrix ?? JSON.parse(readFileSync(defaultFixturePath, "utf8")));
  const pendingExternalCases = validated.externalCases.map(({id, platforms, surface, scenario, execution, status, notRun, reason, requires}) => ({id, platforms, surface, scenario, execution, status, notRun, reason, requires}));
  return {
    kind: "portico.native-acceptance-source-evidence",
    version: 2,
    program: validated.program,
    requirements: validated.requirements,
    status: "source-evidence-only",
    runtimeStatus: "not-run",
    execution: {
      mode: "source-only",
      deterministic: true,
      sourceAssertionsExecuted: false,
      sourceHashesComputed: true,
      deviceRun: false,
      simulatorRun: false,
      emulatorRun: false,
      networkRun: false,
      providerCredentialsUsed: false,
      runtimeStatus: "not-run",
      claim: "source-evidence-only",
    },
    platforms: validated.platforms.map(({id, family, formFactor, playerAuthority, sourceStatus, runtimeStatus}) => ({id, family, formFactor, playerAuthority, sourceStatus, runtimeStatus})),
    matrix: {
      caseCount: validated.cases.length,
      externalCaseCount: pendingExternalCases.length,
      pendingExternalCaseCount: pendingExternalCases.length,
      sourceReferenceCount: validated.cases.reduce((count, item) => count + item.sourceRefs.length, 0),
    },
    cases: validated.cases.map(({id, requirement, surface, scenario, platforms, status}) => ({id, requirement, surface, scenario, platforms, status})),
    pendingExternalCases,
    sourceEvidence: sourceEvidence(root, validated),
    note: "This evidence hashes declared repository source only. It does not execute case assertions and does not claim simulator, emulator, physical-device, LAN, or provider execution.",
  };
}

function parseArguments(argv) {
  let json = false;
  let fixturePath = defaultFixturePath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      if (json) fail("--json was supplied more than once");
      json = true;
    } else if (argument === "--fixture") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) fail("--fixture requires a path");
      fixturePath = isAbsolute(value) ? value : resolve(repositoryRoot, value);
    } else {
      fail(`unknown argument ${argument}`);
    }
  }
  return {json, fixturePath};
}

function main(argv) {
  const {json, fixturePath} = parseArguments(argv);
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const evidence = buildSourceOnlyEvidence({root: repositoryRoot, matrix: fixture});
  if (json) {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    return;
  }
  process.stdout.write(`native acceptance: ${evidence.status}; runtime: ${evidence.runtimeStatus}\n`);
  process.stdout.write(`source cases: ${evidence.matrix.caseCount}; pending runtime/network/provider cases: ${evidence.matrix.pendingExternalCaseCount}\n`);
  for (const item of evidence.pendingExternalCases) process.stdout.write(`PENDING ${item.id}: ${item.reason}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
