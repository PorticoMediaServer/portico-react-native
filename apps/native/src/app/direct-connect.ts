import {connectPairedServer, inspectDirectServer, type ConnectionEnvironment} from '../../../../packages/client-core/src/server-connections';
import {HttpLocalApi, type SystemInfo} from '../../../../packages/client-core/src/index';
import {routePath} from '../../../../packages/contracts/src/routes';
import type {ServerPin} from '../../../../packages/client-core/src/route-identity';
import {DEFAULT_SERVER_PORT, serverAddress, serverAddressCandidates} from '../../../../packages/client-core/src/server-address';
import {activeI18n, present, ShownError} from './errors';

/**
 * Direct connect (TV-AUTH-01): inspect → connect → system as one fenced
 * sequence. No React Native imports: tested under Node.
 *
 * A connect is one attempt at one address. The address field bumps the
 * session generation on every keystroke, so an attempt that is still in
 * flight when a newer one starts (an edit, a repeated Continue, Back and
 * reconnect) must not publish its pin or hand back its API: `isCurrent`
 * rejects it, the way `settleDirect` already does for password sign-ins.
 * Without the fence the first Continue pins a stale identity and the second
 * one works from clean state.
 */

/**
 * What a person types is rarely a URL. The shared rule (`server-address.ts`) turns it into the
 * short list of addresses worth trying, most likely first: an address typed with its scheme is
 * used exactly as typed; a home-looking one is tried over plain HTTP on Portico's own port first;
 * anything else over HTTPS first and then plain HTTP, which a server accepts from any address.
 * IPv6 addresses may be typed bare or in brackets. `serverAddress` is the most likely of them.
 */
export {DEFAULT_SERVER_PORT, serverAddress};

/** How long each candidate address is given to answer: the most likely one the full wait, the others a shorter one. */
const FIRST_WAIT_MS = 15000;
const NEXT_WAIT_MS = 6000;

/** A signal that ends when `outer` does or after `ms`, whichever is first (Hermes has no `AbortSignal.timeout`). */
function within(ms: number, outer: AbortSignal): {signal: AbortSignal; done: () => void; expired: () => boolean} {
  const controller = new AbortController();
  const stop = () => controller.abort();
  let expired = false;
  const timer = setTimeout(() => { expired = true; stop(); }, ms);
  if (outer.aborted) stop(); else outer.addEventListener('abort', stop, {once: true});
  return {signal: controller.signal, done: () => { clearTimeout(timer); outer.removeEventListener('abort', stop); }, expired: () => expired};
}

/** An address that gave no answer in its time: unreachable, never a generic failure. */
const noAnswer = () => Object.assign(new Error('The address gave no answer in time.'), {code: 'timeout'});

/** How long the likeliest address is given alone before the next is asked as well. */
const STAGGER_MS = 1500;

/**
 * Asks the candidates most likely first, without waiting for each in turn: the next one is asked
 * as soon as the one before fails, or once it has gone STAGGER_MS without answering. The most
 * likely address that answers wins (an address is taken only once every likelier one has failed),
 * so a server that answers at once is the only address contacted, and nothing answering takes
 * about the longest single wait rather than every wait added up. When none answers, the most
 * likely address's failure is the one reported.
 */
export async function firstAnsweringAtOnce<T>(candidates: readonly string[], probe: (origin: string, index: number, signal: AbortSignal) => Promise<T>, signal: AbortSignal, stagger = STAGGER_MS): Promise<{origin: string; value: T}> {
  const controllers = candidates.map(() => new AbortController());
  const stopAll = () => { for (const c of controllers) c.abort(); };
  if (signal.aborted) stopAll(); else signal.addEventListener('abort', stopAll, {once: true});
  const outcomes: ({value: T} | {error: unknown} | undefined)[] = candidates.map(() => undefined);
  let next = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abandon = () => {};
  try {
    return await new Promise((resolve, reject) => {
      let decided = false;
      // Abandoned before any address answered: it ends now, with nothing more asked.
      abandon = () => { if (!decided) { decided = true; reject(Object.assign(new Error('The search was cancelled.'), {code: 'cancelled'})); } };
      if (signal.aborted) { abandon(); return; }
      signal.addEventListener('abort', abandon, {once: true});
      const decide = () => {
        if (decided) return;
        for (let i = 0; i < outcomes.length; i++) {
          const outcome = outcomes[i];
          if (!outcome) return;
          if ('value' in outcome) { decided = true; resolve({origin: candidates[i]!, value: outcome.value}); return; }
        }
        decided = true;
        reject((outcomes[0] as {error: unknown}).error);
      };
      const ask = () => {
        clearTimeout(timer);
        if (decided || next >= candidates.length) return;
        const i = next++;
        if (next < candidates.length) timer = setTimeout(ask, stagger);
        probe(candidates[i]!, i, controllers[i]!.signal).then(
          value => { outcomes[i] = {value}; decide(); },
          error => { outcomes[i] = {error}; if (!signal.aborted) ask(); decide(); },
        );
      };
      ask();
    });
  } finally {
    // The answer is decided (or the attempt abandoned): whatever is still asking stops.
    clearTimeout(timer);
    signal.removeEventListener('abort', abandon);
    signal.removeEventListener('abort', stopAll);
    stopAll();
  }
}

/**
 * Finds the server for a typed address: the likely addresses are asked, most likely first, and
 * the most likely one that answers and proves an identity is used. Nothing is trusted because it answered;
 * the identity it proves is what gets pinned.
 */
export async function findDirectServer(typed: string, env: ConnectionEnvironment, signal: AbortSignal): Promise<{address: string; identity: ServerPin}> {
  const found = await firstAnsweringAtOnce(serverAddressCandidates(typed), async (origin, index, own) => {
    const wait = within(index === 0 ? FIRST_WAIT_MS : NEXT_WAIT_MS, own);
    try { return await inspectDirectServer(origin, env, wait.signal); }
    catch (e) {
      // Stopped by a timer (this wait's, or the identity check's own) rather than by the person: no answer.
      const stopped = wait.expired() || (!own.aborted && (e as {code?: unknown} | null)?.code === 'cancelled');
      throw stopped ? noAnswer() : e;
    }
    finally { wait.done(); }
  }, signal);
  return {address: found.origin, identity: found.value};
}

/** How long the first-run question is given at each address. */
const SETUP_ASK_MS = 6000;

/**
 * Whether the server behind a typed address says nobody has set it up yet, asked once the person
 * has finished typing it, before anything is sent to it: the likely addresses in sign-in order,
 * and the first that answers decides. Only an offer hangs on it (first run from a phone or
 * tablet), so any failure to find out means no.
 */
export async function addressNeedsSetup(typed: string, fetcher: typeof fetch, signal: AbortSignal): Promise<boolean> {
  let candidates: readonly string[];
  try { candidates = serverAddressCandidates(typed); } catch { return false; }
  try {
    const found = await firstAnsweringAtOnce(candidates, async (origin, _index, own) => {
      const wait = within(SETUP_ASK_MS, own);
      try { return await new HttpLocalApi(origin, '', fetcher).request<SystemInfo>(routePath('get_system'), 'GET', undefined, wait.signal); } finally { wait.done(); }
    }, signal);
    return found.value?.setupRequired === true;
  } catch {
    return false;
  }
}

/** What was typed, as the name to call the server by before it has said its own. */
export function typedHost(typed: string): string {
  return typed.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '') || activeI18n().t('servers.fallbackName');
}

/**
 * Why no server was found for what was typed, in the sign-in's own words: something that cannot
 * be an address says what one looks like, and an address nothing answered at says it could not
 * be reached. Any other failure is left for the sign-in presenter.
 */
export function addressFailure(error: unknown, typed: string): unknown {
  if ((error as {code?: unknown} | null)?.code === 'invalid_address') return new ShownError(activeI18n().t('web.signIn.error.address'));
  const p = present(error, 'sign-in');
  return p.category === 'unreachable' || p.category === 'offline' || p.category === 'timeout' ? new ShownError(activeI18n().t('web.signIn.error.unreachable', {server: typedHost(typed)})) : error;
}

/** The address or the server behind it changed while a sign-in was under way. */
export function changedWhileSigningIn(typed: string): ShownError {
  return new ShownError(activeI18n().t('web.signIn.error.changed', {server: typedHost(typed)}));
}

export type DirectConnectRequest = {
  /** As typed; the address that answers is found once, here, so inspect and connect cannot disagree. */
  origin: string;
  /** The pinned identity, when an earlier attempt already proved this address. */
  pin?: ServerPin;
  /** The address that answered for `pin`. Without it a pinned attempt goes to the most likely address for what was typed. */
  address?: string;
  env: ConnectionEnvironment;
  signal: AbortSignal;
  /** False when a newer address or sign-in attempt superseded this one. */
  isCurrent: () => boolean;
  /** A server nobody has set up is handed back (with what it says about itself) instead of refused: first run from a phone or tablet. */
  allowSetup?: boolean;
};

/** Inspect, pair and check the server at `origin`. The route connection belongs
 * to the returned API; on failure it is disposed (a failed attempt keeps
 * nothing probing in the background). */
export async function connectDirectServer(request: DirectConnectRequest): Promise<{api: HttpLocalApi; pin: ServerPin; address: string; setup?: SystemInfo}> {
  const changed = () => changedWhileSigningIn(request.origin);
  let identity = request.pin;
  let address = request.pin ? request.address ?? serverAddress(request.origin) : '';
  if (!identity) {
    try {
      const found = await findDirectServer(request.origin, request.env, request.signal);
      identity = found.identity;
      address = found.address;
    } catch (e) {
      throw addressFailure(e, request.origin);
    }
    if (!request.isCurrent()) throw changed();
  }
  let connected: Awaited<ReturnType<typeof connectPairedServer>> | undefined;
  try {
    connected = await connectPairedServer(address, identity, request.env, request.signal);
    const info = await connected.api.system();
    if (!request.isCurrent()) throw changed();
    if (info.setupRequired && !request.allowSetup) throw new ShownError(activeI18n().t('setup.app.notSetUp'));
    const api = connected.api;
    connected = undefined;
    return {api, pin: identity, address, ...(info.setupRequired ? {setup: info} : {})};
  } finally {
    if (connected) connected.connection.dispose();
  }
}
