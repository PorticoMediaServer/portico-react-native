import {DownloadsService} from '../../../../../packages/client-core/src/downloads-service';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {createNativeOfflineDownloadsAdapter, offlineDownloads, type NativeOfflineDownloadsDevice, type OfflineEntry} from '../../platform/offline-downloads';
import {createNativeOfflineEntryPlayback} from './playback';

import {claimNativeDownloadsDevice} from '../../shell/downloads-device-custody';
type DownloadDeviceLease = Readonly<{device: NativeOfflineDownloadsDevice; service: DownloadsService;
  want: (...args: Parameters<typeof offlineDownloads.want>) => ReturnType<typeof offlineDownloads.want>;
  display: (...args: Parameters<typeof offlineDownloads.display>) => ReturnType<typeof offlineDownloads.display>;
  dispose: () => void}>;
type SharedDevice = {lease: DownloadDeviceLease; references: number};
const authorities = new WeakMap<NativeShellBootstrapContext, WeakMap<typeof offlineDownloads, SharedDevice>>();

/** Saved and Downloads borrow one connection for their actual bootstrap authority.
 * Opening the Downloads route must not retire the still-mounted Saved hub. */
export function createNativeDownloadsDevice(context: NativeShellBootstrapContext, device = offlineDownloads): DownloadDeviceLease {
  let devices = authorities.get(context);
  if (!devices) {devices = new WeakMap(); authorities.set(context, devices);}
  const pool = devices;
  let shared = pool.get(device);
  if (!shared) {shared = {lease: connectNativeDownloadsDevice(context, device), references: 0}; pool.set(device, shared);}
  const current = shared;
  current.references++;
  let released = false;
  const assertBorrowed = () => {if (released) throw Object.assign(new Error('cancelled'), {code: 'cancelled'});};
  const source = current.lease.device;
  let playback: ReturnType<typeof createNativeOfflineEntryPlayback>;
  try {playback = createNativeOfflineEntryPlayback(context, source, () => !released);}
  catch (error) {
    current.references--;
    if (current.references === 0) {if (pool.get(device) === current) pool.delete(device); current.lease.dispose();}
    throw error;
  }
  const openOffline = playback.openOffline;
  const borrowed: NativeOfflineDownloadsDevice = {
    ...source,
    getSnapshot: () => {assertBorrowed(); return source.getSnapshot();},
    subscribe: listener => {assertBorrowed(); return source.subscribe(() => {if (!released) listener();});},
    open: () => {assertBorrowed(); return source.open();},
    setSettings: settings => {assertBorrowed(); return source.setSettings(settings);},
    pause: entry => {assertBorrowed(); return source.pause(entry);},
    resume: entry => {assertBorrowed(); return source.resume(entry);},
    remove: entry => {assertBorrowed(); return source.remove(entry);},
    removeOthers: () => {assertBorrowed(); return source.removeOthers();},
    playable: entry => {assertBorrowed(); return source.playable(entry);},
    playabilityReason: entry => {assertBorrowed(); return source.playabilityReason(entry);},
    note: entry => {assertBorrowed(); return source.note(entry);},
    displayFacts: async entry => {assertBorrowed(); const facts = await source.displayFacts(entry); assertBorrowed(); return facts;},
    localMedia: async entry => {assertBorrowed(); const media = await source.localMedia(entry); assertBorrowed(); return media;},
    ...(openOffline ? {openOffline: async (entry: OfflineEntry) => {assertBorrowed(); await openOffline(entry);}} : {}),
  };
  return Object.freeze({device: Object.freeze(borrowed), service: current.lease.service,
    want: (...args) => {assertBorrowed(); return current.lease.want(...args);},
    display: (...args) => {assertBorrowed(); return current.lease.display(...args);},
    dispose: () => {
    if (released) return;
    released = true;
    playback.dispose();
    if (--current.references !== 0) return;
    if (pool.get(device) === current) pool.delete(device);
    current.lease.dispose();
  }});
}

/** Native files remain in the genuine singleton; the server prepares receipts only. */
function connectNativeDownloadsDevice(context: NativeShellBootstrapContext, device: typeof offlineDownloads): DownloadDeviceLease {
  const lifetime = nativeDestinationLifetime(context), viewer = context.session()!.viewer;
  const abort = new AbortController(); let alive = true;
  let custody: ReturnType<typeof claimNativeDownloadsDevice> | undefined;
  const current = () => alive && lifetime.current() && custody?.current() === true;
  const assertCurrent = () => {if (!current()) throw Object.assign(new Error('cancelled'), {code: 'cancelled'});};
  const api = {
    get baseUrl() {assertCurrent(); return context.api.baseUrl;},
    mediaUrl: (path: string) => {assertCurrent(); return context.api.mediaUrl(path);},
    request: async <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
      assertCurrent(); const round = new AbortController();
      const stop = () => round.abort(); abort.signal.addEventListener('abort', stop, {once: true}); signal?.addEventListener('abort', stop, {once: true});
      try {
        if (abort.signal.aborted || signal?.aborted) round.abort();
        const result = await context.api.request<T>(path, method, body, round.signal); assertCurrent(); return result;
      } finally {abort.signal.removeEventListener('abort', stop); signal?.removeEventListener('abort', stop);}
    },
  };
  const service = new DownloadsService(api);
  custody = claimNativeDownloadsDevice(device, () => {alive = false; abort.abort(); service.stop(); service.dispose();});
  device.adopt(viewer);
  const adapter = createNativeOfflineDownloadsAdapter(undefined, device);
  let opening: Promise<void> | undefined, connected = false;
  const open = (): Promise<void> => {
    assertCurrent();
    if (opening) return opening;
    const task = adapter.open().then(() => {
      assertCurrent();
      // Connect after the actual native read succeeds. A failed native read is
      // returned to the screen's retry state, not an unhandled connect chain.
      if (!connected && adapter.getSnapshot().supported) {
        device.connect(api, service, viewer);
        // The service's list and the device's whole-container requests are only
        // read while it is started and following this device (legacy downloads
        // provider did both on active). Without them nothing is ever fetched or
        // enrolled, even after a persisted want.
        service.start();
        const deviceId = context.session()?.deviceId;
        if (deviceId) service.followDevice(deviceId);
        connected = true;
      }
    }).finally(() => {if (opening === task) opening = undefined;});
    opening = task; return task;
  };
  const guarded: NativeOfflineDownloadsDevice = {
    ...adapter,
    getSnapshot: () => {assertCurrent(); return adapter.getSnapshot();},
    subscribe: listener => {assertCurrent(); return adapter.subscribe(() => {if (current()) listener();});},
    open,
    setSettings: settings => {assertCurrent(); return adapter.setSettings(settings);},
    pause: entry => {assertCurrent(); return adapter.pause(entry);},
    resume: entry => {assertCurrent(); return adapter.resume(entry);},
    remove: entry => {assertCurrent(); return adapter.remove(entry);},
    removeOthers: () => {assertCurrent(); return adapter.removeOthers();},
    displayFacts: async entry => {assertCurrent(); const facts = await adapter.displayFacts(entry); assertCurrent(); return facts;},
    localMedia: async entry => {assertCurrent(); const media = await adapter.localMedia(entry); assertCurrent(); return media;},
    playable: entry => {assertCurrent(); return adapter.playable(entry);},
    playabilityReason: entry => {assertCurrent(); return adapter.playabilityReason(entry);},
    note: entry => {assertCurrent(); return adapter.note(entry);},
  };
  return Object.freeze({device: Object.freeze(guarded), service,
    want: (...args) => {assertCurrent(); return device.want(...args);},
    display: (...args) => {assertCurrent(); return device.display(...args);},
    dispose: () => {
      if (!alive) return; alive = false; abort.abort(); service.stop(); service.dispose();
      // A late retired screen cannot disconnect a newer restored viewer.
      if (custody?.current() === true) {custody.release(); device.disconnect(); device.adopt(undefined);}
    },
  });
}
