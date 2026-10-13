import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import type {V1Http} from '../../../../packages/client-core/src/playback-v1/http';
import {CapabilityPublisher} from '../../../../packages/client-core/src/playback-v1/options';
import type {RouteSnapshot} from '../../../../packages/client-core/src/route-connection';
import type {CapabilityProfile} from '../../../../packages/client-core/src/playback-v1/options';
import type {NativeFacts} from './device-profile';
import {deviceCapabilityDocument} from './capability-document';
import {androidFamily, isTablet} from './device-platform';
import type {MpvDeviceFacts} from './mpv-profile';
import {mpvAvailable, mpvDeviceFacts} from './player-engines';
import {engineSettingStore} from '../player/engine-setting-store';

const version: string = (() => { try { return String(require('../../package.json').version ?? ''); } catch { return ''; } })();

async function facts(): Promise<NativeFacts | null> {
  try { return (await NativeModules.PorticoCapabilities?.facts()) ?? null; } catch { return null; }
}

/**
 * Keeps a Playback v1 server told what this device plays: the capability document, with one
 * profile per player engine (the platform's own and, where the build has it, mpv), the viewer's
 * Player setting, and what the app's own audio engine decodes, so music plays `direct` (spec
 * §18.1). Sent once now, and again when the answer changes (another display or receiver,
 * headphones, a local or remote route, the Player setting). Only a changed document is sent. It never throws. `ready` settles once the first profile was sent (or couldn't be), so the
 * first v1 play can wait for it; `stop` stops watching.
 */
export function keepCapabilitiesPublished(http: V1Http, route?: Readonly<{getSnapshot(): RouteSnapshot; subscribe(listener: () => void): () => void}>): Readonly<{ready: Promise<void>; stop: () => void}> {
  const publisher = new CapabilityPublisher(http);
  let stopped = false, settle: ReturnType<typeof setTimeout> | undefined, origin = route?.getSnapshot().origin ?? null;
  let sending: Promise<void> = Promise.resolve();
  const publish = (): Promise<void> => {
    // Serialize writes: a slow earlier PUT must not overwrite a newer engine preference.
    sending = sending.then(async () => {
      const setting = engineSettingStore.get(), revision = engineSettingStore.version();
      const [native, mpv] = await Promise.all([facts(), mpvDeviceFacts()]);
      if (stopped || engineSettingStore.version() !== revision) return;
      const document = deviceCapabilityDocument({setting, native, mpv: mpv as MpvDeviceFacts | null, mpvAvailable, appVersion: version, device: {television: Platform.isTV, pad: isTablet, family: androidFamily, osVersion: String(Platform.Version)}});
      // This repository's shared-package copy still names the older capability shape.
      await publisher.publish(document as unknown as CapabilityProfile).catch(() => {});
      engineSettingStore.settled(revision);
    }).catch(() => {});
    return sending;
  };
  const initial = publish();
  const ready = initial.then(async () => {
    // A preference change during the first probe is queued behind it; include that write in
    // startup readiness as well, so the first session uses the viewer's saved player.
    for (;;) { const pending = sending; await pending; if (pending === sending) return; }
  });
  const changed = () => { if (settle) clearTimeout(settle); settle = setTimeout(() => void publish(), 1500); };
  const module = NativeModules.PorticoCapabilities;
  const subscription = module ? new NativeEventEmitter(module).addListener('portico.capabilities', changed) : undefined;
  const offRoute = route?.subscribe(() => { const next = route.getSnapshot().origin; if (next && next !== origin) { origin = next; changed(); } });
  // The server plans for the player the viewer chose, so a change of the setting is sent at once.
  const offSetting = engineSettingStore.subscribe(() => void publish());
  return Object.freeze({ready, stop: () => { stopped = true; if (settle) clearTimeout(settle); subscription?.remove(); offRoute?.(); offSetting(); }});
}
