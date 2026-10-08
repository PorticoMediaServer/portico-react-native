import {NativeEventEmitter, NativeModules} from 'react-native';
import {ClientProfilePublisher} from '../../../../packages/client-core/src/client-profile';
import {deviceClientProfile, type NativeFacts} from './device-profile';

type Api = {request<T>(path: string, method?: string, body?: unknown): Promise<T>};

const version: string = (() => { try { return String(require('../../package.json').version ?? ''); } catch { return ''; } })();

/** What the system says about this device now, or null when it cannot be asked (an old build of
 *  the native side): the profile then rests on the declared table for the platform alone. */
async function facts(): Promise<NativeFacts | null> {
  try { return (await NativeModules.PorticoCapabilities?.facts()) ?? null; } catch { return null; }
}

/**
 * Keeps this sign-in's server told what the device plays: once after sign-in, and again when
 * the answer changes (an Apple TV moved to another television or receiver, headphones
 * connected, the display's HDR setting switched). It never throws and nothing waits for it.
 * Returns a function that stops watching.
 */
export function keepDeviceProfilePublished(api: Api, signIn: string): () => void {
  const publisher = new ClientProfilePublisher((path, method, body) => api.request<unknown>(path, method, body), () => signIn);
  let stopped = false, settle: ReturnType<typeof setTimeout> | undefined;
  const publish = async () => {
    const native = await facts();
    if (stopped) return;
    void publisher.publish(deviceClientProfile(native, version));
  };
  void publish();
  // A route change arrives as a burst (old route lost, new one found); ask once it has settled.
  const changed = () => { if (settle) clearTimeout(settle); settle = setTimeout(() => void publish(), 1500); };
  const module = NativeModules.PorticoCapabilities;
  const subscription = module ? new NativeEventEmitter(module).addListener('portico.capabilities', changed) : undefined;
  return () => { stopped = true; if (settle) clearTimeout(settle); subscription?.remove(); };
}
