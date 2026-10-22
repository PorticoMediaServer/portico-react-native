import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NativeModules, Platform} from './react-native-stub.mjs';
import {selectionHaptic} from '../src-next/platform/haptics.ts';
const modules = NativeModules as unknown as Record<string, unknown>;

test('selection entry makes one real request and returns only native admission', async () => {
  const prior = modules.PorticoHaptics, os = Platform.OS, tv = Platform.isTV;
  let calls = 0, admitted = true;
  modules.PorticoHaptics = {selection: async () => { calls++; return admitted; }};
  try {
    Platform.isTV = false;
    for (const target of ['android', 'ios']) {
      Platform.OS = target;
      assert.equal(await selectionHaptic(), true);
      admitted = false;
      assert.equal(await selectionHaptic(), false);
      admitted = true;
    }
    assert.equal(calls, 4);
    assert.equal(await selectionHaptic(false), false);
    assert.equal(calls, 4);
  } finally { modules.PorticoHaptics = prior; Platform.OS = os; Platform.isTV = tv; }
});

test('absent, rejected, malformed and unsupported haptic capabilities never report success', async () => {
  const prior = modules.PorticoHaptics, os = Platform.OS, tv = Platform.isTV;
  try {
    Platform.OS = 'android'; Platform.isTV = false;
    delete modules.PorticoHaptics;
    assert.equal(await selectionHaptic(), false);
    modules.PorticoHaptics = {selection: async () => { throw new Error('Unavailable'); }};
    assert.equal(await selectionHaptic(), false);
    modules.PorticoHaptics = {selection: async () => 'true'};
    assert.equal(await selectionHaptic(), false);
    modules.PorticoHaptics = {selection: () => { throw new Error('Must not be called'); }};
    Platform.isTV = true; assert.equal(await selectionHaptic(), false);
    Platform.OS = 'ios'; assert.equal(await selectionHaptic(), false);
    Platform.isTV = false; Platform.OS = 'web'; assert.equal(await selectionHaptic(), false);
  } finally { modules.PorticoHaptics = prior; Platform.OS = os; Platform.isTV = tv; }
});

test('native source uses policy-respecting view feedback and UIKit without permissions or simulated receipts', () => {
  const android = readFileSync(new URL('../android/app/src/main/java/tv/getportico/portico/native/PorticoHaptics.kt', import.meta.url), 'utf8');
  assert.match(android, /performHapticFeedback\(HapticFeedbackConstants\.LONG_PRESS\)/);
  assert.match(android, /promise\.resolve\(admitted\)/);
  assert.doesNotMatch(android, /IGNORE_GLOBAL_SETTING|IGNORE_VIEW_SETTING|VIBRATE|VibrationEffect/);
  const apple = readFileSync(new URL('../Native/PorticoHaptics.m', import.meta.url), 'utf8');
  assert.match(apple, /TARGET_OS_TV \|\| TARGET_OS_SIMULATOR/);
  assert.match(apple, /\[feedback selectionChanged\]/);
  for (const platform of ['ios', 'tvos']) {
    const project = readFileSync(new URL(`../${platform}/Portico.xcodeproj/project.pbxproj`, import.meta.url), 'utf8');
    assert.match(project, /PorticoHaptics\.m in Sources/);
  }
});
