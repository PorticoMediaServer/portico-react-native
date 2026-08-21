/*
 * This module is part of the production Metro bootstrap. The Foundation
 * generator writes the JSON artifact before a bundle is built; this module
 * publishes that one artifact before any Portico application module imports
 * Hosted client infrastructure.
 */
/* global globalThis */
'use strict';

const generatedBuildContract = require('./generated/portico-build-contract.generated.json');

const BUILD_CONTRACT_GLOBAL = '__PORTICO_BUILD_CONTRACT__';
const BUILD_CONTRACT_FIELDS = [
  'version',
  'apiVersion',
  'environment',
  'distribution',
  'hostedApiBaseUrl',
  'appVersion',
  'buildNumber',
  'commit',
];

function sameBuildContract(left, right) {
  return BUILD_CONTRACT_FIELDS.every(field => left?.[field] === right?.[field]);
}

function installPorticoBuildContract() {
  const globalObject = globalThis;
  const existing = globalObject[BUILD_CONTRACT_GLOBAL];
  if (existing !== undefined) {
    if (!sameBuildContract(existing, generatedBuildContract)) {
      throw new Error(
        'The Portico build contract was initialized by more than one authority.',
      );
    }
    return existing;
  }

  const value = Object.freeze({...generatedBuildContract});
  Object.defineProperty(globalObject, BUILD_CONTRACT_GLOBAL, {
    configurable: true,
    enumerable: false,
    writable: false,
    value,
  });
  return value;
}

module.exports = {installPorticoBuildContract};
installPorticoBuildContract();
