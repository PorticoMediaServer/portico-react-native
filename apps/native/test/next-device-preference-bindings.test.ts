import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeModules} from './react-native-stub.mjs';
import {NativeQueueStore} from '../src-next/platform/queue-storage';
import {bindNativeDeviceSettings} from '../src-next/platform/device-settings';
import {readNativeDevicePreference} from '../src-next/screens/settings/device-preference-bindings';

const key = 'preferences:v1';
const device = (extra: Record<string, unknown> = {}) => ({playerEngine: 'automatic', forceStereo: false, disableHdr: false, ...extra});
type State = {raw: string | null; saves: number; loads: number; beforeSave?: () => Promise<void>; beforeRead?: () => Promise<void>};

async function records(run: (state: State) => Promise<void>, raw = JSON.stringify(device())) {
  const runtime = NativeModules.PorticoRuntime as Record<string, unknown>, old = {read: runtime.loadQueueRecord, write: runtime.saveQueueRecord};
  const state: State = {raw, saves: 0, loads: 0};
  runtime.loadQueueRecord = async (recordKey: string) => {assert.equal(recordKey, key); state.loads++; await state.beforeRead?.(); return state.raw;};
  runtime.saveQueueRecord = async (recordKey: string, next: string) => {assert.equal(recordKey, key); await state.beforeSave?.(); state.raw = next; state.saves++;};
  try {await run(state);} finally {runtime.loadQueueRecord = old.read; runtime.saveQueueRecord = old.write;}
}

async function fixture() {
  const storage = new NativeQueueStore(), listeners = new Set<() => void>();
  let current = true;
  const observed = await storage.change(key, raw => ({record: raw, value: raw}));
  const owner = {current: () => current, subscribePreferences: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};}};
  const ports = {storage, readRecord: () => observed, acceptRecord: () => {}};
  return {owner, source: bindNativeDeviceSettings(owner, ports), retire: () => {current = false;}};
}

const value = (current: unknown) => ({current, effective: current, default: undefined, source: 'device', configOnly: false});

test('canonical device rows decode through the one installed source', async () => {
  await records(async () => {
    const f = await fixture();
    assert.deepEqual(readNativeDevicePreference('device.player', f.source), value('mpv'));
    assert.deepEqual(readNativeDevicePreference('audioSubtitles.surround', f.source), value('stereo'));
    assert.deepEqual(readNativeDevicePreference('quality.disableHdr', f.source), value(true));
  }, JSON.stringify(device({playerEngine: 'mpv', forceStereo: true, disableHdr: true})));
});

test('automatic player, asis surround and HDR enabled decode without inventing a default', async () => {
  await records(async () => {
    const f = await fixture();
    assert.deepEqual(readNativeDevicePreference('device.player', f.source), value('auto'));
    assert.deepEqual(readNativeDevicePreference('audioSubtitles.surround', f.source), value('asis'));
    assert.deepEqual(readNativeDevicePreference('quality.disableHdr', f.source), value(false));
  });
});

test('non-device, multi-key and unsupported rows are unavailable without reading the source', async () => {
  await records(async state => {
    const f = await fixture(), original = f.source.read, reads: string[] = [], loads = state.loads;
    f.source.read = id => {reads.push(id); return original(id);};
    try {
      for (const rowId of ['device.playerLink', 'device.receive', 'quality.tvSupports', 'playback.skipping', 'general.name', 'unknown.row']) {
        assert.equal(readNativeDevicePreference(rowId, f.source), undefined, rowId);
      }
      assert.deepEqual(reads, []);
      assert.equal(state.loads, loads);
      assert.equal(state.saves, 0);
    } finally {f.source.read = original;}
  });
});
