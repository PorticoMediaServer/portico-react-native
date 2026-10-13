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

/** The port a Portico server listens on unless its owner chose another. */
export const DEFAULT_SERVER_PORT = 32500;

/**
 * What a person types is rarely a URL. An address with a scheme is used as typed. A bare one gets
 * the scheme and the port it most likely needs:
 *
 * - a number (an IPv4 address, or an IPv6 address in brackets) or a name that only means
 *   something at home (`localhost`, a one-word name, `.local`, `.lan`, `.home`, `.internal`,
 *   `.home.arpa`) is a server reached directly: plain HTTP, on Portico's own port unless a port
 *   was typed. No certificate can exist for such an address, so HTTPS could never answer.
 * - any other name is a published address: HTTPS, on the port typed or the usual one.
 */
export function serverAddress(typed: string): string {
  const value = typed.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(value)) return value;
  const parts = /^(\[[0-9a-f:.]+\]|[^:/\s[\]]+)(?::(\d{1,5}))?(\/.*)?$/i.exec(value);
  // Not a host this can read: left for the connection to refuse with its own message.
  if (!parts) return 'https://' + value;
  const [, host, port, path = ''] = parts;
  const number = host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const home = number || /^(localhost|[^.]+|.+\.local|.+\.lan|.+\.home|.+\.internal|.+\.home\.arpa)$/i.test(host);
  if (!home) return 'https://' + value;
  return `http://${host}:${port ?? DEFAULT_SERVER_PORT}${path}`;
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
