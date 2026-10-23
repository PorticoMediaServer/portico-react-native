import {DownloadsService} from '../../../../../packages/client-core/src/downloads-service';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeDestinationLifetime} from '../destinations/lifetime';
import {createNativeOfflineDownloadsAdapter, offlineDownloads, type NativeOfflineDownloadsDevice} from '../../platform/offline-downloads';

let connection: object | undefined;

/** The genuine singleton is connected once for this screen authority, never
 * replaced by server preparations or a second native-file store. */
export function createNativeDownloadsDevice(context: NativeShellBootstrapContext, device = offlineDownloads) {
  const lifetime = nativeDestinationLifetime(context), viewer = context.session()!.viewer;
  const owner = {}, abort = new AbortController(); let alive = true;
  const current = () => alive && lifetime.current() && connection === owner;
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
  connection = owner;
  device.connect(api, service, viewer);
  const adapter = createNativeOfflineDownloadsAdapter(undefined, device);
  const guarded: NativeOfflineDownloadsDevice = {
    ...adapter,
    getSnapshot: () => {assertCurrent(); return adapter.getSnapshot();},
    subscribe: listener => {assertCurrent(); return adapter.subscribe(() => {if (current()) listener();});},
    open: () => {assertCurrent(); return adapter.open();},
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
  return Object.freeze({device: Object.freeze(guarded),
    dispose: () => {
      if (!alive) return; alive = false; abort.abort(); service.dispose();
      // A late retired screen cannot disconnect a newer restored viewer.
      if (connection === owner) {connection = undefined; device.disconnect(); device.adopt(undefined);}
    },
  });
}
