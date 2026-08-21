/* Test-only fixture for modules imported without a native Metro entrypoint. */
'use strict';

globalThis.__PORTICO_BUILD_CONTRACT__ = Object.freeze({
  version: 1,
  apiVersion: 'v1',
  environment: 'test',
  distribution: 'simulator',
  hostedApiBaseUrl: 'https://hosted.test',
  appVersion: '0.1.0-test',
  buildNumber: '42',
  commit: 'jest-test-commit',
});
