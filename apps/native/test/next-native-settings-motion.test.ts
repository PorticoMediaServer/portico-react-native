import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import {parsePreferenceSnapshot} from '../../../packages/client-core/src/preferences';
import {nativeAppearanceMotion} from '../src-next/screens/settings/appearance-policy';
import {createTheme} from '../src-next/kit/theme';
import {act, createHookHost} from './hook-driver';
import {screenModule} from './helpers/screen-harness.mjs';

const deferred = <T>() => {let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
function snapshot(motion?: 'follow' | 'reduce') {
  const effective = motion === undefined ? {'playback.skipBackMs': 10000} : {'appearance.motion': motion};
  const key = Object.keys(effective)[0]!;
  return parsePreferenceSnapshot({deviceClass: 'mobile', deviceBound: true, registryRevision: 'motion-fixture', registry: {revision: 'motion-fixture', fields: [
    {key, type: motion === undefined ? 'number' : 'string', default: effective[key as keyof typeof effective], group: 'appearance', labelKey: `preferences.${key}`, scopes: ['profile-device']},
  ]}, documents: ['profile-server', 'profile-device-class', 'profile-device'].map(scope => ({scope, revision: 1, activeRevision: 1, digest: 'd'.repeat(64), values: scope === 'profile-device' ? effective : {}})),
    effective, effectiveSource: {[key]: 'profile-device'}, clampedFields: []});
}

test('motion policy reads only the published canonical value, without inventing an older registry value', () => {
  assert.equal(nativeAppearanceMotion(snapshot('follow')), 'follow');
  assert.equal(nativeAppearanceMotion(snapshot('reduce')), 'reduce');
  assert.equal(nativeAppearanceMotion(snapshot()), undefined);
});

async function fixture(inheritedReduced = false, supported = true) {
  let motion: 'follow' | 'reduce' | undefined = 'follow', event: ((value: boolean) => void) | undefined, removals = 0;
  const pending = deferred<boolean>(), errors: unknown[] = [], listeners = new Set<() => void>();
  const inherited = createTheme({isTV: false, width: 834, textScale: 1.25, reduceMotion: inheritedReduced});
  const source = {get appearanceMotion() {return motion;}, subscribe: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};}, reportError: (error: unknown) => {errors.push(error);}};
  const native = {isReduceMotionEnabled() {assert.equal(this, native); return pending.promise;}, addEventListener(name: string, listener: (value: boolean) => void) {
    assert.equal(this, native); assert.equal(name, 'reduceMotionChanged'); event = listener; return {remove() {removals++;}};
  }};
  const {NativeSettingsAppearance} = await screenModule(new URL('../src-next/screens/settings/NativeSettingsAppearance.tsx', import.meta.url), {
    react: {...React, default: React}, 'react-native': {AccessibilityInfo: supported ? native : undefined},
    '../../kit/theme': {ThemeProvider: 'ThemeProvider', useTheme: () => inherited},
  });
  const child = React.createElement('existing-shell'), tree = {current: undefined as any};
  const host = createHookHost(() => {tree.current = NativeSettingsAppearance({source, children: child});});
  await act(() => host.mount());
  return {tree, pending, errors, listeners, child, inherited, source,
    event: () => event!, removals: () => removals,
    policy: async (value: typeof motion) => {await act(() => {motion = value; for (const listener of listeners) listener();});},
    close: () => host.unmount(),
  };
}

test('confirmed motion and genuine OS events drive the same theme without changing its canvas, scale or child', async () => {
  const f = await fixture();
  try {
    assert.equal(f.tree.current.type, 'ThemeProvider');
    assert.equal(f.tree.current.props.width, f.inherited.width); assert.equal(f.tree.current.props.textScale, 1.25);
    assert.equal(f.tree.current.props.children, f.child);
    assert.equal(f.tree.current.props.reduceMotion, false);
    await f.policy('reduce'); assert.equal(f.tree.current.props.reduceMotion, true);
    await f.policy('follow'); assert.equal(f.tree.current.props.reduceMotion, false);
    await act(() => f.event()(true)); assert.equal(f.tree.current.props.reduceMotion, true);
    await act(() => f.pending.resolve(false)); assert.equal(f.tree.current.props.reduceMotion, true, 'a late initial query cannot undo a newer OS event');
    await act(() => f.event()(false)); assert.equal(f.tree.current.props.reduceMotion, false);
    await f.policy(undefined); assert.equal(f.tree.current.props.reduceMotion, false);
    assert.deepEqual(f.errors, []);
  } finally {f.close();}
  assert.equal(f.removals(), 1); assert.equal(f.listeners.size, 0);
});

test('retirement removes both subscriptions and rejects late OS answers while inherited reduced motion stays authoritative', async () => {
  const f = await fixture(true), queued = f.event();
  assert.equal(f.tree.current.props.reduceMotion, true);
  f.close();
  await act(() => {queued(false); f.pending.resolve(false);});
  assert.equal(f.removals(), 1); assert.equal(f.listeners.size, 0); assert.deepEqual(f.errors, []);
});

test('an unavailable OS API preserves the current theme and an actual read refusal uses existing feedback', async () => {
  const unavailable = await fixture(true, false);
  assert.equal(unavailable.tree.current.props.reduceMotion, true); unavailable.close();
  const f = await fixture(), error = new Error('native accessibility read refused');
  try {await act(() => f.pending.reject(error)); assert.deepEqual(f.errors, [error]); await f.policy('reduce'); assert.equal(f.tree.current.props.reduceMotion, true);}
  finally {f.close();}
});
