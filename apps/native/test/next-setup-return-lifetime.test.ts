import test from 'node:test';
import assert from 'node:assert/strict';
import {standardHomeApp} from './helpers/standard-home-app-harness.mjs';

// Regression source only. The real source command is retained; a held claim
// boundary lets the original form retire before any credential publication.
test('native setup completion refuses a retired opening and releases only its original returned custody', async t => {
  const app = await standardHomeApp({setup: true});
  const {NativeServerSignIn} = await import('../src-next/platform/server-sign-in.ts');
  try {
    for (const mode of ['pre-aborted', 'retired', 'aborted'] as const) await t.test(mode, async () => {
      const source = new NativeServerSignIn();
      await source.inspect('https://standard-home.test');
      let calls = 0, released = 0, accepted = 0, live = true;
      let finish!: (completion: unknown) => void;
      // No token/session fixture is needed: original lifetime must refuse before
      // inspecting or installing this returned grant, and release its own handle.
      const claim = {finishInstalled: () => {calls++; return new Promise(resolve => {finish = resolve;});}, dispose() {}};
      (source as unknown as {hostedSetup: unknown}).hostedSetup = claim;
      const life = new AbortController(); if (mode === 'pre-aborted') life.abort();
      const before = app.requests.length;
      const pending = source.finishHostedSetup({signal: life.signal, isCurrent: () => live});
      const rejected = assert.rejects(pending);
      if (mode !== 'pre-aborted') {
        if (mode === 'retired') live = false; else life.abort();
        finish({api: {getRouteConnection: () => undefined}, release: async () => {released++;}, accept: () => {accepted++;}});
      }
      await rejected;
      assert.equal(calls, mode === 'pre-aborted' ? 0 : 1);
      assert.equal(released, mode === 'pre-aborted' ? 0 : 1); assert.equal(accepted, 0);
      assert.equal(app.requests.length, before, 'retired completion sends no new setup or credential request');
      source.dispose();
    });
  } finally {await app.unmount(); app.disposeLoader();}
});
