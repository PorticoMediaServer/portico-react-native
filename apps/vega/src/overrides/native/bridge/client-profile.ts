import {NativeEventEmitter, NativeModules} from 'react-native';
import {ClientProfilePublisher} from '../../../../../../packages/client-core/src/client-profile';
import {vegaClientProfile, type VegaFacts} from '../../../bridge/capability-profile';

type Api = {request<T>(path: string, method?: string, body?: unknown): Promise<T>; baseUrl?: string};

async function facts(): Promise<VegaFacts | null> {
  try { return (await NativeModules.PorticoCapabilities?.facts()) ?? null; } catch { return null; }
}

/**
 * Keeps this sign-in's server told what the device plays: once after sign-in, and again when
 * the answer changes (another television or receiver behind the stick, a different display mode).
 * It never throws and nothing waits for it. Returns a function that stops watching.
 *
 * The Vega counterpart of the Apple binding of the same name: the profile is client-core's Vega
 * table, narrowed by what the device reports.
 */
export function keepDeviceProfilePublished(api: Api, signIn: string): () => void {
  const publisher = new ClientProfilePublisher((path, method, body) => api.request<unknown>(path, method, body), () => signIn);
  let stopped = false, settle: ReturnType<typeof setTimeout> | undefined;
  const publish = async () => {
    const native = await facts();
    if (stopped) return;
    void publisher.publish(vegaClientProfile(native, api.baseUrl ?? null));
  };
  void publish();
  // A change arrives as a burst; ask once it has settled.
  const changed = () => { if (settle) clearTimeout(settle); settle = setTimeout(() => void publish(), 1500); };
  const module = NativeModules.PorticoCapabilities;
  const subscription = module ? new NativeEventEmitter(module).addListener('portico.capabilities', changed) : undefined;
  return () => { stopped = true; if (settle) clearTimeout(settle); subscription?.remove(); };
}
