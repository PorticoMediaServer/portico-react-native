import assert from 'node:assert/strict';
import test from 'node:test';
import {measureNativeHost, relativeToRoot} from '../src-next/dev/layout-dump/native-host.ts';
import {createNativeMeasurementRegistry, curateFlattenedStyle} from '../src-next/dev/layout-dump/registry.ts';
import {collectNativeScreen} from '../src-next/dev/layout-dump/collect.ts';
import {installNativeLayoutDump, registerNativeHost} from '../src-next/dev/layout-dump/index.ts';

function host(name: string, box: {x: number; y: number; width: number; height: number}, children: object[] = []) {
  return {nodeType: 1, nodeName: name, isConnected: true, childNodes: children,
    offsetWidth: box.width, offsetHeight: box.height, getBoundingClientRect: () => ({...box})};
}
const paint = {fontFamily: 'Public Test Font', fontSize: 24, fontWeight: 700, color: 'rgb(237, 245, 250)',
  effectiveOpacity: 1, effectiveBackgroundColor: 'rgb(7, 16, 24)'};

test('native host numbers remain fractional logical window coordinates, never density-adjusted', async () => {
  const result = await measureNativeHost(host('RN:View', {x: 10.25, y: 20.5, width: 300.75, height: 400.125}));
  assert.ok('rect' in result);
  assert.deepEqual(result.rect, {x: 10.25, y: 20.5, width: 300.75, height: 400.125});
  assert.deepEqual(relativeToRoot(result.rect, {x: 2.25, y: 4.5, width: 390, height: 844}), {x: 8, y: 16, width: 300.75, height: 400.125});
  assert.equal('unavailable' in await measureNativeHost({getBoundingClientRect: () => ({x: NaN, y: 0, width: 10, height: 10})}), true);
});

test('late native callbacks are retired after cancellation or deadline', async () => {
  let callback: ((x: number, y: number, width: number, height: number) => void) | undefined;
  const controller = new AbortController();
  const pending = measureNativeHost({measureInWindow: value => {callback = value;}}, {signal: controller.signal, timeoutMs: 100});
  controller.abort();
  assert.deepEqual(await pending, {unavailable: 'capture cancelled'});
  callback!(1, 2, 3, 4);
  assert.deepEqual(await measureNativeHost({measureInWindow() {}}, {timeoutMs: 1}), {unavailable: 'native measurement callback did not arrive'});
});

test('curated diagnostics never read getters, arbitrary props, URLs, objects or asset references', () => {
  const raw = {fontSize: 24, opacity: .5, color: '#edf5fa', transform: [{scale: 2}], source: 'private.png',
    backgroundColor: 'url(https://example.invalid/private.jpg)', fontFamily: '/private/font.ttf', password: 'never-read'};
  Object.defineProperty(raw, 'fontWeight', {get() {throw new Error('getter was read');}});
  assert.deepEqual(curateFlattenedStyle(raw), {fontSize: 24, color: '#edf5fa', opacity: .5});
  assert.deepEqual(curateFlattenedStyle([raw]), {});
});

test('diagnostics cannot supply measured paint/font facts and invalidation does not invent defaults', () => {
  const registry = createNativeMeasurementRegistry(), node = {};
  const lease = registry.register(node, {kind: 'text', flattenedStyle: {opacity: .5, fontFamily: 'Input Font', fontSize: 24}});
  assert.deepEqual(registry.read(node)?.measuredStyle, {});
  assert.equal(registry.read(node)?.effectiveOpacity, undefined);
  lease.recordResolvedStyle(paint);
  assert.equal(registry.read(node)?.measuredStyle.fontSize, '24px');
  lease.recordTextLayout([{x: 1, y: 2, width: 30, height: 20, text: 'Visible'}]);
  lease.update({kind: 'text', flattenedStyle: {fontSize: 30}});
  assert.equal(registry.read(node)?.lines, undefined);
  assert.equal(registry.read(node)?.effectiveOpacity, undefined);
});

test('actual native focus events are lease/epoch bound; stale blur never clears a newer host', () => {
  const registry = createNativeMeasurementRegistry(), first = {}, second = {}, mounted = new Set([first, second]);
  const a = registry.register(first, {kind: 'view'}), b = registry.register(second, {kind: 'view'});
  assert.equal(registry.actualFocus(first, mounted), undefined);
  a.recordNativeFocus(true);
  assert.equal(registry.actualFocus(first, mounted), true);
  b.recordNativeFocus(true);
  a.recordNativeFocus(false);
  assert.equal(registry.actualFocus(second, mounted), true);
  b.unregister();
  assert.equal(registry.actualFocus(first, mounted), undefined);
  const replacement = registry.register(first, {kind: 'view'});
  replacement.recordNativeFocus(true);
  a.unregister(); a.recordNativeFocus(false);
  assert.equal(registry.actualFocus(first, mounted), true);
  registry.retireEpoch();
  replacement.recordNativeFocus(true);
  assert.equal(registry.actualFocus(first, mounted), undefined);
});

test('inputs never accept text layout or export native input internals', async () => {
  const registry = createNativeMeasurementRegistry();
  const input = host('RN:AndroidTextInput', {x: 10, y: 20, width: 100, height: 40});
  for (const key of ['childNodes', 'value', 'textContent', 'props']) Object.defineProperty(input, key, {get() {throw new Error('private field was read');}});
  const lease = registry.register(input, {kind: 'input'});
  lease.recordTextLayout(new Proxy([], {get() {throw new Error('input text was read');}}));
  lease.recordMaskLength(4);
  const root = host('RN:View', {x: 0, y: 0, width: 390, height: 844}, [input]);
  const measured = await collectNativeScreen({root, viewport: {width: 390, height: 844, deviceScaleFactor: 3}, platform: 'android', registry});
  assert.equal(measured.viewport.deviceScaleFactor, 3);
  assert.equal(measured.elements[1].ownText, '');
  assert.deepEqual(measured.elements[1].input, {value: null, redacted: true, maskedLength: 4});
  assert.deepEqual(measured.strings, []);
});

test('only observed native window Text rectangles become text ranges; host boxes never substitute', async () => {
  const registry = createNativeMeasurementRegistry();
  const text = host('RN:Text', {x: 20, y: 40, width: 100, height: 30});
  const root = host('RN:View', {x: 0, y: 0, width: 390, height: 844}, [text]);
  const textLease = registry.register(text, {kind: 'text', semanticId: 'public-title', role: 'header'});
  textLease.recordTextLayout([{x: 2, y: 3, width: 70, height: 24, text: 'Public title', capHeight: 17}]);
  textLease.recordResolvedStyle(paint);
  textLease.observeTextRectangles(async () => [{x: 22, y: 43, width: 70, height: 24}]);
  textLease.recordNativeFocus(true);
  registry.register(root, {kind: 'view'}).recordResolvedStyle({effectiveOpacity: 1, effectiveBackgroundColor: 'rgb(7, 16, 24)'});
  const options = {root, viewport: {width: 390, height: 844, deviceScaleFactor: 3}, platform: 'android' as const, registry, anchors: {'public-title': 'title'}};
  const measured = await collectNativeScreen(options);
  assert.equal(measured.fullViewport, true);
  assert.equal(measured.elements[1].focused, true);
  assert.deepEqual(measured.elements[1].textRects, [{x: 22, y: 43, width: 70, height: 24}]);
  assert.equal(measured.elements[1].frame, 'title');
  assert.equal(measured.strings[0].text, 'Public title');
  textLease.observeTextRectangles(undefined);
  const transformed = await collectNativeScreen(options);
  assert.equal(transformed.elements[1].textRects, undefined);
  assert.ok(transformed.unavailable.some(fact => fact.element === 'root.0' && fact.property === 'textRects'));
});

test('late window Text observers are retired on unregister or cancellation', async () => {
  const registry = createNativeMeasurementRegistry(), node = {};
  const lease = registry.register(node, {kind: 'text'});
  let resolve: ((value: unknown) => void) | undefined;
  lease.observeTextRectangles(() => new Promise(done => {resolve = done;}));
  const controller = new AbortController();
  const pending = registry.measureTextRectangles(node, controller.signal);
  await Promise.resolve();
  controller.abort();
  assert.equal(await pending, undefined);
  resolve!([{x: 1, y: 2, width: 3, height: 4}]);
  const again = registry.measureTextRectangles(node);
  await Promise.resolve();
  lease.unregister();
  resolve!([{x: 1, y: 2, width: 3, height: 4}]);
  assert.equal(await again, undefined);
});

test('unobserved paint hides text and never defaults focus or opacity; wrong viewport fails', async () => {
  const registry = createNativeMeasurementRegistry(), text = host('RN:Text', {x: 0, y: 0, width: 100, height: 30});
  registry.register(text, {kind: 'text'}).recordTextLayout([{x: 0, y: 0, width: 70, height: 24, text: 'Do not export without visibility'}]);
  const root = host('RN:View', {x: 0, y: 24, width: 390, height: 844}, [text]);
  const measured = await collectNativeScreen({root, viewport: {width: 390, height: 844, deviceScaleFactor: 2}, platform: 'ios', registry});
  assert.equal(measured.fullViewport, false);
  assert.equal(measured.elements[1].focused, null);
  assert.equal(measured.elements[1].effectiveOpacity, null);
  assert.equal(measured.elements[1].ownText, undefined);
  assert.deepEqual(measured.strings, []);
  assert.ok(measured.unavailable.some(fact => fact.property === 'focused'));
  assert.ok(measured.unavailable.some(fact => fact.property === 'ownText'));
});

test('DEV entry is inert in production and disposal refuses a late native capture', async () => {
  const globals = globalThis as typeof globalThis & {__DEV__?: boolean};
  const original = globals.__DEV__;
  try {
    globals.__DEV__ = false;
    assert.equal(registerNativeHost({}, {kind: 'view'}), undefined);
    assert.equal(installNativeLayoutDump({root() {throw new Error('production read a native root');}, viewport() {throw new Error('production read viewport');}, platform: 'android'}), undefined);
    globals.__DEV__ = true;
    let callback: ((x: number, y: number, width: number, height: number) => void) | undefined;
    const root = {measureInWindow(value: typeof callback) {callback = value;}};
    const installed = installNativeLayoutDump({root: () => root, viewport: () => ({width: 390, height: 844, deviceScaleFactor: 3}), platform: 'android'})!;
    const pending = installed.capture();
    installed.dispose();
    await assert.rejects(pending, /cancelled|disposed/);
    callback!(0, 0, 390, 844);
  } finally {
    if (original === undefined) delete globals.__DEV__;
    else globals.__DEV__ = original;
  }
});
