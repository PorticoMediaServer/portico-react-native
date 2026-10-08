/**
 * Why signing in to a Portico Account's server failed, in words that say what failed (Justin:
 * never a generic "Some details weren't accepted"). The shell shows it with the action that fits.
 * `category` is the shared error presentation's category for the same error. No React Native
 * imports: tested under Node.
 */
import {challengeNotProven} from '../../../../packages/client-core/src/portico-servers';
import {unreadableServerResponse} from '../../../../packages/client-core/src/server-messages';

export type PorticoFailureKind =
  /** The server (or Portico, for it) no longer admits this account. */
  | 'noAccess'
  /** No route to the server answered: off, asleep or offline. */
  | 'unreachable'
  /** The server's clock is too far from Portico's. */
  | 'clockSkew'
  /** This app and the server don't speak the same sign-in (one of them needs an update). */
  | 'incompatible'
  /** The server couldn't prove it is the server chosen; nothing was sent. */
  | 'identity'
  /** The server's owner has to approve this device first. */
  | 'devicePending'
  /** The server's owner declined this device. */
  | 'deviceDenied'
  /** The server moved this sign-in to its own membership: re-admitted silently, never shown. */
  | 'migrated'
  | 'other';
export type PorticoFailure = Readonly<{kind: PorticoFailureKind; server: string; code?: string; status?: number; /** Development builds only: where and what, for diagnosis. */ detail?: string}>;
export type PorticoStage = 'route' | 'signIn';

const unreachable = new Set(['offline', 'unreachable', 'timeout', 'unavailable', 'busy']);

export function classifyPorticoFailure(error: unknown, stage: PorticoStage, server: string, category?: string): PorticoFailure {
  const e = error as {code?: unknown; status?: unknown; message?: unknown} | null;
  const code = typeof e?.code === 'string' ? e.code : undefined;
  const status = typeof e?.status === 'number' ? e.status : undefined;
  const message = typeof e?.message === 'string' ? e.message : '';
  const at = (kind: PorticoFailureKind): PorticoFailure => Object.freeze({kind, server, ...(code ? {code} : {}), ...(status !== undefined ? {status} : {})});
  if (code === 'access_refused' || (stage === 'route' && status === 403)) return at('noAccess');
  if (code === 'clock_skew') return at('clockSkew');
  if (code === 'session_migrated') return at('migrated');
  if (code === 'device_approval_pending') return at('devicePending');
  if (code === 'device_denied') return at('deviceDenied');
  if (message === challengeNotProven || code === 'identity_mismatch' || message === 'The server answered as a different server.') return at('identity');
  // A failed fetch is a TypeError too; a TypeError that isn't one is a fault here, not the network.
  const fault = error instanceof TypeError && !/network|load failed|fetch|abort/i.test(message);
  if (category && unreachable.has(category) && !fault) return at('unreachable');
  if (stage === 'route' && (code === 'server_unavailable' || code === 'route_unavailable')) return at('unreachable');
  // The sign-in chain itself was refused as malformed, or answered in a shape this app can't read:
  // one side is older than the other (seen: an app without the challenge nonce on a newer server).
  if (stage === 'signIn' && (status === 400 || status === 404 || status === 405 || status === 501 || code === 'invalid_request' || message === unreadableServerResponse || category === 'unsupported-version')) return at('incompatible');
  return at('other');
}
