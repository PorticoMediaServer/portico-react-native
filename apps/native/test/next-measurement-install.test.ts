import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';
import * as collector from '../src-next/dev/layout-dump/index.ts';

const globals = globalThis as typeof globalThis & {
  __DEV__?: boolean;
  __PORTICO_NATIVE_LAYOUT_DUMP__?: Pick<collector.NativeLayoutDump, 'capture'>;
};

test('App measurement command borrows only the current public root and live viewport from the real collector', async () => {
  const original = globals.__DEV__;
  globals.__DEV__ = true;
  let dispose: (() => void) | undefined;
  try {
    let current = true, width = 390, height = 844, density = 3, reads = 0;
    const root = {nodeType: 1, nodeName: 'RN:View', isConnected: true, childNodes: [],
      getBoundingClientRect: () => ({x: 0, y: 0, width, height})};
    const {installNativePublicMeasurement} = await screenModule(new URL('../src-next/dev/measurement-install.ts', import.meta.url), {
      react: {default: {}}, './layout-dump': collector,
      'react-native': {Platform: {OS: 'android', isTV: false}, Dimensions: {get: (kind: string) => {
        assert.equal(kind, 'window'); return {width, height};
      }}, PixelRatio: {get: () => density}},
    });
    dispose = installNativePublicMeasurement(() => {reads++; return root;}, () => current);
    const command = globals.__PORTICO_NATIVE_LAYOUT_DUMP__!;
    assert.deepEqual(Object.keys(command), ['capture']);
    assert.equal(Object.isFrozen(command), true);
    const first = await command.capture();
    assert.deepEqual(first.viewport, {width: 390, height: 844, deviceScaleFactor: 3});
    assert.equal(first.fullViewport, true);
    width = 844; height = 390; density = 2;
    assert.deepEqual((await command.capture()).viewport, {width, height, deviceScaleFactor: density});
    assert.throws(() => installNativePublicMeasurement(() => root, () => true), /already installed/);
    current = false;
    const previousReads = reads;
    await assert.rejects(command.capture(), /mounted whole-screen native root/);
    assert.equal(reads, previousReads, 'retirement refuses before lending the root to the collector');
    assert.ok(dispose);
    dispose(); dispose = undefined;
    assert.equal(globals.__PORTICO_NATIVE_LAYOUT_DUMP__, undefined);
    await assert.rejects(command.capture(), /disposed/);
  } finally {
    dispose?.();
    if (original === undefined) delete globals.__DEV__; else globals.__DEV__ = original;
  }
});

test('production never installs the public command or reads a host', async () => {
  const original = globals.__DEV__;
  globals.__DEV__ = false;
  try {
    const {installNativePublicMeasurement} = await screenModule(new URL('../src-next/dev/measurement-install.ts', import.meta.url), {
      react: {default: {}}, './layout-dump': collector, 'react-native': {},
    });
    installNativePublicMeasurement(() => {throw new Error('private host read');}, () => {throw new Error('private predicate read');})();
    assert.equal(globals.__PORTICO_NATIVE_LAYOUT_DUMP__, undefined);
  } finally {
    if (original === undefined) delete globals.__DEV__; else globals.__DEV__ = original;
  }
});
