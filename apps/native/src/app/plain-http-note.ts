import {HttpLocalApi} from '../../../../packages/client-core/src/index';
import {plainHttpOutsideHome, type ConnectionReader} from '../../../../packages/client-core/src/connection-note';
import {firstAnswering, serverAddressCandidates} from '../../../../packages/client-core/src/server-address';

/**
 * The quiet line a sign-in screen shows when the server says this device reaches it over plain
 * HTTP from outside the owner's home networks. The server alone decides (its home-networks setting
 * is the one definition); the app never guesses from an address. It is only ever a note: any
 * failure to find out means no note, nothing waits on it, and signing in works the same with or
 * without it.
 *
 * No React Native imports: tested under Node.
 */

/** How long one address is given to say how it is being reached. */
const ASK_MS = 5000;

function within(ms: number, outer?: AbortSignal): {signal: AbortSignal; done: () => void} {
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, ms);
  if (outer?.aborted) stop(); else outer?.addEventListener('abort', stop, {once: true});
  return {signal: controller.signal, done: () => { clearTimeout(timer); outer?.removeEventListener('abort', stop); }};
}

/** Asks a server this device is already talking to. */
export async function serverSaysPlainHttp(api: ConnectionReader, signal?: AbortSignal): Promise<boolean> {
  const wait = within(ASK_MS, signal);
  try { return await plainHttpOutsideHome(api, wait.signal); } finally { wait.done(); }
}

/**
 * Asks the server behind a typed address, before anything has been sent to it. The likely
 * addresses are asked in the order a sign-in would try them, and the first that answers decides:
 * when that one is HTTPS there is nothing to say. No credential and no identifier is sent.
 */
export async function addressSaysPlainHttp(typed: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<boolean> {
  let candidates: readonly string[];
  try { candidates = serverAddressCandidates(typed); } catch { return false; }
  try {
    const found = await firstAnswering(candidates, async origin => {
      const wait = within(ASK_MS, signal);
      try { return await new HttpLocalApi(origin, '', fetcher).connection(wait.signal); } finally { wait.done(); }
    }, signal);
    return found.origin.startsWith('http://') && found.value.plainHttpOutsideHome === true;
  } catch {
    return false;
  }
}
