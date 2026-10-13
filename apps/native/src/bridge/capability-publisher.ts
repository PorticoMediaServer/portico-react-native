import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import type {V1Http} from '../../../../packages/client-core/src/playback-v1/http';
import {CapabilityPublisher} from '../../../../packages/client-core/src/playback-v1/options';
import type {NativeFacts} from './device-profile';
import {deviceCapabilityDocument, probedDevice} from './capability-document';
import {androidFamily, isTablet} from './device-platform';
import type {MpvDeviceFacts} from './mpv-profile';
import {mpvAvailable, mpvDeviceFacts} from './player-engines';
import {engineSettingStore} from '../player/engine-setting-store';

const version: string = (() => { try { return String(require('../../package.json').version ?? ''); } catch { return ''; } })();

async function facts(): Promise<NativeFacts | null> {
  try { return (await NativeModules.PorticoCapabilities?.facts()) ?? null; } catch { return null; }
}

/**
 * Keeps the server told what this device plays: the one capability document, with a profile per
 * player engine (the platform's own and, where the build has it, mpv), the viewer's Player setting
 * and overrides (force stereo, no passthrough, no HDR), the screen, the audio output, and what the
 * app's own audio engine decodes, so music plays `direct` (spec §18.1). Sent once now, and again
 * when the answer changes (another display or receiver, headphones, a setting). Only a changed
 * document is sent. It never throws. `ready` settles once the first document was sent (or could
 * not be), so the first play can wait for it; `stop` stops watching.
 *
 * (`_route` is the selected server's route, which the document does not depend on here. The Vega
 * app's binding of the same name does read it, and shares this call.)
 */
export function keepCapabilitiesPublished(http: V1Http, _route?: unknown): Readonly<{ready: Promise<void>; stop: () => void}> {
  const publisher = new CapabilityPublisher(http);
  let stopped = false, settle: ReturnType<typeof setTimeout> | undefined;
  let sending: Promise<void> = Promise.resolve();
  const publish = (): Promise<void> => {
    // One write at a time: a slow earlier PUT must not land after, and undo, a newer setting.
    sending = sending.then(async () => {
      const setting = engineSettingStore.get(), overrides = engineSettingStore.overrides(), revision = engineSettingStore.version();
      const [native, mpv] = await Promise.all([facts(), mpvDeviceFacts()]);
      if (stopped || engineSettingStore.version() !== revision) return;
      const document = deviceCapabilityDocument({setting, overrides, native, mpv: mpv as MpvDeviceFacts | null, mpvAvailable, appVersion: version, device: {television: Platform.isTV, pad: isTablet, family: androidFamily, osVersion: String(Platform.Version)}});
      engineSettingStore.setProbed(probedDevice(document));
      await publisher.publish(document).catch(() => false);
      engineSettingStore.settled(revision);
    }).catch(() => {});
    return sending;
  };
  // The viewer's saved Player setting and fixes are read from the device's store first (briefly,
  // and bounded): publishing the defaults would undo what the server already holds for them.
  const initial = engineSettingStore.whenLoaded(2000).then(() => (stopped ? undefined : publish()));
  const ready = initial.then(async () => {
    // A setting changed during the first probe is queued behind it; that write is part of being
    // ready too, so the first session is planned for the player the viewer saved.
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
