import {AppState, NativeEventEmitter, NativeModules} from 'react-native';
import type {CapabilityDocument} from '../../../../../../packages/client-core/src/client-profile';
import type {V1Http} from '../../../../../../packages/client-core/src/playback-v1/http';
import {CapabilityPublisher} from '../../../../../../packages/client-core/src/playback-v1/options';
import type {RouteSnapshot} from '../../../../../../packages/client-core/src/route-connection';
import {engineSettingStore} from '../../../../../native/src/player/engine-setting-store';
import {probeVegaPlayer} from '../../../bridge/capability-probe';
import {probedSettings, vegaCapabilityDocument, type VegaFacts} from '../../../bridge/capability-profile';

async function facts(): Promise<VegaFacts | null> {
  try { return (await NativeModules.PorticoCapabilities?.facts()) ?? null; } catch { return null; }
}

/** How long the first document waits for the device's own answers before the table is sent. */
const PROBE_WAIT_MS = 3000;

/**
 * Keeps the server told what this device plays (the capability document): once now, and again
 * when the answer changes (a secure or plain route, one of the viewer's overrides, the device's
 * own answers arriving late). Only a changed document is sent. It never throws. `ready` settles
 * once the first document was sent (or couldn't be), so the first play can wait for it; `stop`
 * stops watching.
 *
 * The Vega counterpart of the Apple and Android binding of the same name. There is one player
 * engine here, so the document has one profile and the Player setting is always Automatic.
 */
export function keepCapabilitiesPublished(http: V1Http, route?: Readonly<{getSnapshot(): RouteSnapshot; subscribe(listener: () => void): () => void}>): Readonly<{ready: Promise<void>; stop: () => void}> {
  const publisher = new CapabilityPublisher(http);
  let stopped = false, settle: ReturnType<typeof setTimeout> | undefined, origin = route?.getSnapshot().origin ?? null;
  let sending: Promise<void> = Promise.resolve();
  // What the device itself says it plays. Asked once; a first document that could not wait for
  // the answer is followed by another when it arrives.
  let probed: CapabilityDocument | null = null, answered = false;
  let probeGeneration = 0;
  const probe = (refresh = false) => {
    const generation = ++probeGeneration;
    answered = false;
    return probeVegaPlayer(refresh).then(document => { if (generation === probeGeneration) { probed = document; answered = true; } });
  };
  let probing = probe();
  const publish = (): Promise<void> => {
    // One write at a time: a slow earlier PUT must not land after, and undo, a newer setting.
    sending = sending.then(async () => {
      const revision = engineSettingStore.version(), overrides = engineSettingStore.overrides();
      const [native] = await Promise.all([facts(), Promise.race([probing, new Promise<void>(resolve => setTimeout(resolve, PROBE_WAIT_MS))])]);
      if (stopped || engineSettingStore.version() !== revision) return;
      const late = !answered;
      const document = vegaCapabilityDocument(native, route?.getSnapshot().origin ?? null, overrides, probed, engineSettingStore.declared());
      // Settings offers "Turn off HDR" and "Don't pass sound through" only where the document
      // says there is HDR, or a receiver, to turn off.
      engineSettingStore.setProbed(probedSettings(document));
      await publisher.publish(document).catch(() => false);
      engineSettingStore.settled(revision);
      if (late) void probing.then(() => { if (!stopped && probed) changed(); });
    }).catch(() => {});
    return sending;
  };
  // The viewer's saved overrides are read from the device's store first (briefly, and bounded):
  // publishing the defaults would undo what the server already holds for them.
  const initial = engineSettingStore.whenLoaded(2000).then(() => (stopped ? undefined : publish()));
  const ready = initial.then(async () => {
    // A setting changed during the first write is queued behind it; that write is part of being
    // ready too, so the first title is planned for what the viewer saved.
    for (;;) { const pending = sending; await pending; if (pending === sending) return; }
  });
  // A route change arrives as a burst (old route lost, new one found); ask once it has settled.
  function changed(): void { if (settle) clearTimeout(settle); settle = setTimeout(() => void publish(), 1500); }
  const module = NativeModules.PorticoCapabilities;
  const outputChanged = () => { probed = null; probing = probe(true); changed(); };
  const subscription = module ? new NativeEventEmitter(module).addListener('portico.capabilities', outputChanged) : undefined;
  // A television can change its HDMI sink while this app is backgrounded. Old positive output
  // facts must not survive a resume without asking the SDK again.
  const appState = AppState.addEventListener('change', state => { if (state === 'active') outputChanged(); });
  const offRoute = route?.subscribe(() => { const next = route.getSnapshot().origin; if (next && next !== origin) { origin = next; changed(); } });
  // The server plans from the viewer's settings, so a change of one is sent at once.
  const offSetting = engineSettingStore.subscribe(() => void publish());
  return Object.freeze({ready, stop: () => { stopped = true; if (settle) clearTimeout(settle); subscription?.remove(); appState.remove(); offRoute?.(); offSetting(); }});
}
