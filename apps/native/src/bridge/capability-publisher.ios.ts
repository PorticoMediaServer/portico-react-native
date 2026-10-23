import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import type {V1Http} from '../../../../packages/client-core/src/playback-v1/http';
import {CapabilityPublisher} from '../../../../packages/client-core/src/playback-v1/options';
import type {NativeFacts} from './device-profile';
import {deviceCapabilityDocument, probedDevice} from './capability-document';
import {isTablet} from './device-platform';
import {engineSettingStore} from '../player/engine-setting-store';

const version: string = (() => { try { return String(require('../../package.json').version ?? ''); } catch { return ''; } })();

async function facts(): Promise<NativeFacts | null> {
  try { return (await NativeModules.PorticoCapabilities?.facts()) ?? null; } catch { return null; }
}

/** Publishes the Apple native engine and the current output/overrides serially. */
export function keepCapabilitiesPublished(http: V1Http, _route?: unknown): Readonly<{ready: Promise<void>; stop: () => void}> {
  const publisher = new CapabilityPublisher(http);
  let stopped = false, settle: ReturnType<typeof setTimeout> | undefined;
  let sending: Promise<void> = Promise.resolve();
  const publish = (): Promise<void> => {
    // One write at a time: a slow earlier PUT must not land after, and undo, a newer setting.
    sending = sending.then(async () => {
      const overrides = engineSettingStore.overrides(), revision = engineSettingStore.version();
      const native = await facts();
      if (stopped || engineSettingStore.version() !== revision) return;
      const document = deviceCapabilityDocument({overrides, native, appVersion: version, device: {television: Platform.isTV, pad: isTablet, osVersion: String(Platform.Version)}});
      engineSettingStore.setProbed(probedDevice(document));
      await publisher.publish(document).catch(() => false);
      engineSettingStore.settled(revision);
    }).catch(() => {});
    return sending;
  };
  // Wait briefly for saved device overrides before publishing the Apple engine.
  const initial = engineSettingStore.whenLoaded(2000).then(() => (stopped ? undefined : publish()));
  const ready = initial.then(async () => {
    // A setting changed during the first probe is queued behind it; that write is part of being
    // ready too, so the first session uses the confirmed overrides.
    for (;;) { const pending = sending; await pending; if (pending === sending) return; }
  });
  // A route change arrives as a burst (old route lost, new one found); ask once it has settled.
  const changed = () => { if (settle) clearTimeout(settle); settle = setTimeout(() => void publish(), 1500); };
  const module = NativeModules.PorticoCapabilities;
  const subscription = module ? new NativeEventEmitter(module).addListener('portico.capabilities', changed) : undefined;
  // The server plans from the viewer's settings, so a change of one is sent at once.
  const offSetting = engineSettingStore.subscribe(() => void publish());
  return Object.freeze({ready, stop: () => { stopped = true; if (settle) clearTimeout(settle); subscription?.remove(); offSetting(); }});
}
