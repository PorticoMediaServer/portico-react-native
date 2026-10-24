import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeObservationError, requestNativeObservations} from '../src-next/dev/layout-dump/native-observations.ts';

const native = (value: unknown) => ({value, source: 'android.observed.SDK'});
const response = (facts: Record<string, unknown> = {}) => ({version: 1, unit: 'dp', rootReactTag: 11, fixtureReactTag: 12,
  hosts: [{reactTag: 13, facts}]});
const request = (raw: unknown) => ({rootReactTag: 11, fixtureReactTag: 12, hostReactTags: [11, 12, 13],
  isCurrent: () => true, bridge: {observe: async () => raw}});
const failure = (code: string) => (error: unknown) => error instanceof NativeObservationError && error.code === code;

test('native observation keeps actual false/zero and unavailable separate without reading or forwarding other fields', async () => {
  let reads = 0;
  const facts = {isFocused: native(false), effectiveOpacity: native(0), textColor: native('rgba(10, 20, 30, 0.5)'),
    fontFamily: {unavailable: 'font-family-unavailable'},
    get props() {reads++; throw new Error('private field read');},
    get imageSource() {reads++; throw new Error('asset field read');}};
  const result = await requestNativeObservations(request(response(facts)));
  assert.deepEqual(result.hosts.map(host => host.reactTag), [11, 12, 13]);
  assert.deepEqual(result.hosts[0].facts.isFocused, {unavailable: 'host-not-found'});
  assert.deepEqual(result.hosts[2].facts.isFocused, native(false));
  assert.deepEqual(result.hosts[2].facts.effectiveOpacity, native(0));
  assert.deepEqual(result.hosts[2].facts.fontFamily, {unavailable: 'font-family-unavailable'});
  assert.deepEqual(result.hosts[2].facts.fontSize, {unavailable: 'native-fact-missing'});
  assert.equal(reads, 0);
  assert.equal('props' in result.hosts[2].facts, false);
  assert.equal('imageSource' in result.hosts[2].facts, false);
});

test('malformed native facts do not become paint, identity, focus or raw errors', async () => {
  let getterReads = 0;
  const result = await requestNativeObservations(request(response({
    isFocused: native('false'), effectiveOpacity: native(1.01), fontSize: native(NaN), fontWeight: native(700.5),
    textColor: native('rgba(999, 0, 0, 1)'), fontFamily: native('file:///private/font.ttf'),
    backgroundColor: {get value() {getterReads++; return 'rgba(0, 0, 0, 1)';}, source: 'android.SDK'},
    boxShadow: native('url(private-image)'), lineHeight: {unavailable: '/private/raw-error'},
    textLineRects: native([{x: 0, y: 0, width: -1, height: 30}]),
  })));
  for (const key of ['isFocused', 'effectiveOpacity', 'fontSize', 'fontWeight', 'textColor', 'fontFamily',
    'backgroundColor', 'boxShadow', 'lineHeight', 'textLineRects'] as const) {
    if (key === 'fontFamily') continue;
    assert.deepEqual(result.hosts[2].facts[key], {unavailable: 'invalid-native-fact'});
  }
  assert.equal(getterReads, 0);
  assert.deepEqual(result.hosts[2].facts.fontFamily, {unavailable: 'font-family-unavailable'});
});

test('foreign roots, units, duplicate rows or unrequested hosts reject the whole observation', async () => {
  for (const raw of [{...response(), rootReactTag: 99}, {...response(), fixtureReactTag: 99}, {...response(), unit: 'px'},
    {...response(), hosts: [{reactTag: 99, facts: {}}]}, {...response(), hosts: [{reactTag: 13, facts: {}}, {reactTag: 13, facts: {}}]}]) {
    await assert.rejects(requestNativeObservations(request(raw)), failure('invalid-response'));
  }
});

test('invalid IDs, duplicate IDs and retired fixture refuse before entering native', async () => {
  let calls = 0;
  const base = {...request(response()), bridge: {observe: async () => {calls++; return response();}}};
  for (const override of [{rootReactTag: 0}, {fixtureReactTag: 11}, {hostReactTags: [13, 13]},
    {hostReactTags: Array.from({length: 2001}, (_, i) => i + 1)}]) {
    await assert.rejects(requestNativeObservations({...base, ...override}), failure('invalid-request'));
  }
  await assert.rejects(requestNativeObservations({...base, isCurrent: () => false}), failure('scope-changed'));
  assert.equal(calls, 0);
});

test('fixture retirement and abort discard native results and fence the queued call', async () => {
  let live = true, settle!: (raw: unknown) => void, calls = 0;
  const pending = requestNativeObservations({...request(response()), isCurrent: () => live,
    bridge: {observe: () => {calls++; return new Promise(resolve => {settle = resolve;});}}});
  await Promise.resolve(); live = false; settle(response());
  await assert.rejects(pending, failure('scope-changed'));
  const controller = new AbortController();
  const aborted = requestNativeObservations({...request(response()), signal: controller.signal,
    bridge: {observe: async () => {calls++; return response();}}});
  controller.abort();
  await assert.rejects(aborted, failure('cancelled'));
  assert.equal(calls, 1);
});

test('in-flight cancellation retires publication without claiming the native UI turn stopped', async () => {
  const controller = new AbortController();
  let settle!: (raw: unknown) => void, finished = false;
  const pending = requestNativeObservations({...request(response()), signal: controller.signal,
    bridge: {observe: () => new Promise(resolve => {settle = value => {finished = true; resolve(value);};})}});
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, failure('cancelled'));
  assert.equal(finished, false);
  settle(response());
  await Promise.resolve();
  assert.equal(finished, true);
});

test('request tag identity is captured before asynchronous native work', async () => {
  const base = request(response());
  let observed: unknown;
  base.bridge.observe = async (...args: unknown[]) => {observed = args; return response();};
  const pending = requestNativeObservations(base);
  base.rootReactTag = 99; base.fixtureReactTag = 98; base.hostReactTags.push(999);
  await pending;
  assert.deepEqual(observed, [11, 12, [11, 12, 13]]);
});
