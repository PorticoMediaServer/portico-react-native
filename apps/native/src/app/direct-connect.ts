import {connectPairedServer, inspectDirectServer, type ConnectionEnvironment} from '../../../../packages/client-core/src/server-connections';
import type {HttpLocalApi} from '../../../../packages/client-core/src/index';
import type {ServerPin} from '../../../../packages/client-core/src/route-identity';
import {present, ShownError} from './errors';

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

/** What a person types is rarely a URL. A bare host gets a scheme: plain HTTP for an address on
 * the home network (an IP, localhost, a .local name), HTTPS for anything else. */
export function serverAddress(typed: string): string {
  const value = typed.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(value)) return value;
  const host = value.replace(/[:/].*$/, '');
  const home = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^.]+|.+\.local|.+\.lan|.+\.home)$/i.test(host);
  return (home ? 'http://' : 'https://') + value;
}

export type DirectConnectRequest = {
  /** As typed; normalized once, here, so inspect and connect cannot disagree. */
  origin: string;
  /** The pinned identity, when an earlier attempt already proved this address. */
  pin?: ServerPin;
  env: ConnectionEnvironment;
  signal: AbortSignal;
  /** False when a newer address or sign-in attempt superseded this one. */
  isCurrent: () => boolean;
};

/** Inspect, pair and check the server at `origin`. The route connection belongs
 * to the returned API; on failure it is disposed (a failed attempt keeps
 * nothing probing in the background). */
export async function connectDirectServer(request: DirectConnectRequest): Promise<{api: HttpLocalApi; pin: ServerPin}> {
  const address = serverAddress(request.origin);
  let identity = request.pin;
  if (!identity) {
    try {
      identity = await inspectDirectServer(address, request.env, request.signal);
    } catch (e) {
      const p = present(e, 'sign-in');
      throw p.category === 'unreachable' || p.category === 'offline' || p.category === 'timeout' ? new ShownError('Portico couldn’t reach that server. Check the address and try again.') : e;
    }
    if (!request.isCurrent()) throw new ShownError('The server changed while you were signing in. Try again.');
  }
  let connected: Awaited<ReturnType<typeof connectPairedServer>> | undefined;
  try {
    connected = await connectPairedServer(address, identity, request.env, request.signal);
    const info = await connected.api.system();
    if (!request.isCurrent()) throw new ShownError('The server changed while you were signing in. Try again.');
    if (info.setupRequired) throw new ShownError('This server hasn’t finished setup. Complete setup in a web browser first.');
    const api = connected.api;
    connected = undefined;
    return {api, pin: identity};
  } finally {
    if (connected) connected.connection.dispose();
  }
}
