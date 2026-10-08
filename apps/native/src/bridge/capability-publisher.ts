import {NativeEventEmitter, NativeModules} from 'react-native';
import type {V1Http} from '../../../../packages/client-core/src/playback-v1/http';
import {CapabilityPublisher} from '../../../../packages/client-core/src/playback-v1/options';
import type {RouteSnapshot} from '../../../../packages/client-core/src/route-connection';
import {deviceCapabilityProfile, type NativeFacts} from './device-profile';

const version: string = (() => { try { return String(require('../../package.json').version ?? ''); } catch { return ''; } })();

async function facts(): Promise<NativeFacts | null> {
  try { return (await NativeModules.PorticoCapabilities?.facts()) ?? null; } catch { return null; }
}

/**
 * Keeps a Playback v1 server told what this device plays (spec §3), including what its own audio
 * engine decodes, so music plays `direct` (spec §18.1): once now, and again when the answer changes
 * (another display or receiver, headphones, a local or remote route). Only a changed profile is
 * sent. It never throws. `ready` settles once the first profile was sent (or couldn't be), so the
 * first v1 play can wait for it; `stop` stops watching.
 */
export function keepCapabilitiesPublished(http: V1Http, route?: Readonly<{getSnapshot(): RouteSnapshot; subscribe(listener: () => void): () => void}>): Readonly<{ready: Promise<void>; stop: () => void}> {
  const publisher = new CapabilityPublisher(http);
  let stopped = false, settle: ReturnType<typeof setTimeout> | undefined, origin = route?.getSnapshot().origin ?? null;
  const publish = async () => {
    const native = await facts();
    if (stopped) return;
    const profile = deviceCapabilityProfile(native, route?.getSnapshot().origin ?? null, version);
    await publisher.publish(profile).catch(() => {});
  };
  const ready = publish();
  const changed = () => { if (settle) clearTimeout(settle); settle = setTimeout(() => void publish(), 1500); };
  const module = NativeModules.PorticoCapabilities;
  const subscription = module ? new NativeEventEmitter(module).addListener('portico.capabilities', changed) : undefined;
  const offRoute = route?.subscribe(() => { const next = route.getSnapshot().origin; if (next && next !== origin) { origin = next; changed(); } });
  return Object.freeze({ready, stop: () => { stopped = true; if (settle) clearTimeout(settle); subscription?.remove(); offRoute?.(); }});
}
