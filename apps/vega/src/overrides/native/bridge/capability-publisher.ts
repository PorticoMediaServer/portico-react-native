import {NativeEventEmitter, NativeModules} from 'react-native';
import type {V1Http} from '../../../../../../packages/client-core/src/playback-v1/http';
import {CapabilityPublisher} from '../../../../../../packages/client-core/src/playback-v1/options';
import type {RouteSnapshot} from '../../../../../../packages/client-core/src/route-connection';
import {engineSettingStore} from '../../../../../native/src/player/engine-setting-store';
import {vegaCapabilityDocument, type VegaFacts} from '../../../bridge/capability-profile';

async function facts(): Promise<VegaFacts | null> {
  try { return (await NativeModules.PorticoCapabilities?.facts()) ?? null; } catch { return null; }
}

/**
 * Keeps the server told what this device plays (the capability document): once now, and again
 * when the answer changes (another display or receiver, a secure or plain route, one of the
 * viewer's overrides). Only a changed document is sent. It never throws. `ready` settles once the
 * first document was sent (or couldn't be), so the first play can wait for it; `stop` stops
 * watching.
 *
 * The Vega counterpart of the Apple and Android binding of the same name.
 */
export function keepCapabilitiesPublished(http: V1Http, route?: Readonly<{getSnapshot(): RouteSnapshot; subscribe(listener: () => void): () => void}>): Readonly<{ready: Promise<void>; stop: () => void}> {
  const publisher = new CapabilityPublisher(http);
  let stopped = false, settle: ReturnType<typeof setTimeout> | undefined, origin = route?.getSnapshot().origin ?? null;
  let sending: Promise<void> = Promise.resolve();
  const publish = (): Promise<void> => {
    sending = sending.then(async () => {
      const revision = engineSettingStore.version(), overrides = engineSettingStore.overrides();
      const native = await facts();
      if (stopped || engineSettingStore.version() !== revision) return;
      const document = vegaCapabilityDocument(native, route?.getSnapshot().origin ?? null, overrides);
      // Dolby audio is handed on only once a route is reported, which this device never does:
      // there is nothing to turn off. Its screen may show HDR, so that switch is offered.
      engineSettingStore.setProbed({audioPassthrough: false, hdr: true});
      await publisher.publish(document).catch(() => false);
      engineSettingStore.settled(revision);
    }).catch(() => {});
    return sending;
  };
  // The viewer's saved overrides are read from the device's store first (briefly, and bounded).
  const ready = engineSettingStore.whenLoaded(2000).then(() => (stopped ? undefined : publish()));
  const changed = () => { if (settle) clearTimeout(settle); settle = setTimeout(() => void publish(), 1500); };
  const module = NativeModules.PorticoCapabilities;
  const subscription = module ? new NativeEventEmitter(module).addListener('portico.capabilities', changed) : undefined;
  const offRoute = route?.subscribe(() => { const next = route.getSnapshot().origin; if (next && next !== origin) { origin = next; changed(); } });
  const offSetting = engineSettingStore.subscribe(() => void publish());
  return Object.freeze({ready, stop: () => { stopped = true; if (settle) clearTimeout(settle); subscription?.remove(); offRoute?.(); offSetting(); }});
}
