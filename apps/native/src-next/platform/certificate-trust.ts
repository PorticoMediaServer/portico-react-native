import {
  RouteError,
  probeRoute,
  routeOrigin,
  type RouteCrypto,
} from '../../../../packages/client-core/src/route-identity.ts';

/**
 * The owner's own certificate (self-signed, or from the owner's private authority).
 *
 * The native layer trusts the system's authorities and, at one address, the one certificate
 * pinned there (`PorticoServerTrust` on Android and Apple). When a request meets a certificate it
 * does not trust, it refuses it and remembers its fingerprint. This decides what happens next,
 * safely but without asking anything in the ordinary cases:
 *
 *  - the server signs a nonce-bound identity proof with the fingerprints of the TLS leaf
 *    certificates it serves, from its own configuration; the refused certificate must be listed;
 *  - the first time this address is seen, or when it keeps the same server identity, that
 *    bound certificate is pinned and the request retried;
 *  - missing bindings (including older servers), unlisted certificates and changed identities
 *    ask the person plainly (`certificate_changed` / `certificate_unverified`).
 *
 * A connection still verifies the server identity it expects before it sends any credential, so
 * a certificate pinned here never stands in for that check. Public-authority certificates are
 * accepted by the system as before and never reach this code.
 */
export type PinnedCertificate = Readonly<{fingerprint: string; serverId: string}>;
export interface CertificatePlatform {
  /** The certificate this device most recently refused at the origin, if any. */
  refused(origin: string): Promise<string | undefined>;
  pinned(origin: string): Promise<PinnedCertificate | undefined>;
  pin(origin: string, pin: PinnedCertificate): Promise<void>;
  /** A fetch for the identity proof only, trusting exactly this certificate at the origin. */
  proofFetcher(origin: string, fingerprint: string): typeof fetch;
}
export type PendingCertificate = Readonly<{origin: string; fingerprint: string; serverId: string; reason: 'changed' | 'unverified'}>;

const FINGERPRINT = /^[A-Za-z0-9_-]{43}$/;
/** Proof failures that say the server is not (provably) the Portico server it claims to be. */
const UNPROVEN = new Set(['identity_mismatch', 'invalid_identity', 'invalid_response']);

const pending = new Map<string, PendingCertificate>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<(question: PendingCertificate) => void>();

/**
 * Hear each question as it is recorded, wherever the request was made: a certificate that
 * changes while the app is signed in is asked about where the person is, not only at sign-in.
 */
export function onCertificateQuestion(listener: (question: PendingCertificate) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The https origin of a request URL, or undefined for anything else. */
export function certificateOrigin(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? routeOrigin(u.origin) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * After a request at `origin` failed on a certificate: pin it when that is safe without asking,
 * or record what to ask and throw `certificate_changed` / `certificate_unverified`. Concurrent
 * failures at one origin share one decision.
 */
export function settleCertificate(origin: string, platform: CertificatePlatform, crypto: RouteCrypto, signal?: AbortSignal): Promise<void> {
  const running = inflight.get(origin);
  if (running) return running;
  const decision = decide(origin, platform, crypto, signal).finally(() => inflight.delete(origin));
  inflight.set(origin, decision);
  return decision;
}

async function decide(origin: string, platform: CertificatePlatform, crypto: RouteCrypto, signal?: AbortSignal): Promise<void> {
  const fingerprint = await platform.refused(origin);
  if (!fingerprint || !FINGERPRINT.test(fingerprint)) throw new RouteError('certificate_untrusted', 'Portico couldn’t check this server’s certificate.');
  const previous = await platform.pinned(origin);
  let serverId = '';
  let bound = false;
  try {
    const proof = await probeRoute(origin, undefined, {fetcher: platform.proofFetcher(origin, fingerprint), crypto, signal});
    serverId = proof.serverId;
    bound = proof.tlsCertificateFingerprints?.includes(fingerprint) === true;
  } catch (error) {
    if (!(error instanceof RouteError) || !UNPROVEN.has(error.code)) throw error;
  }
  if (serverId && bound && (!previous || previous.serverId === serverId)) {
    await platform.pin(origin, {fingerprint, serverId});
    pending.delete(origin);
    return;
  }
  const reason = previous ? 'changed' : 'unverified';
  const question: PendingCertificate = {origin, fingerprint, serverId, reason};
  pending.set(origin, question);
  for (const listener of [...listeners]) { try { listener(question); } catch { /* a listener's failure is its own */ } }
  throw reason === 'changed'
    ? new RouteError('certificate_changed', 'This server’s certificate changed, and Portico couldn’t confirm it’s the same server.')
    : new RouteError('certificate_unverified', 'This server uses its own certificate and couldn’t prove it’s a Portico server.');
}

/** What the person is being asked about at this address, if anything. */
export function pendingCertificate(origin: string): PendingCertificate | undefined {
  try {
    return pending.get(routeOrigin(origin.trim().replace(/\/+$/, '')));
  } catch {
    return undefined;
  }
}

/** The person chose to trust the certificate they were asked about. */
export async function acceptPendingCertificate(origin: string, platform: CertificatePlatform): Promise<boolean> {
  const asked = pendingCertificate(origin);
  if (!asked) return false;
  await platform.pin(asked.origin, {fingerprint: asked.fingerprint, serverId: asked.serverId});
  pending.delete(asked.origin);
  return true;
}

/** Test seam: forget every pending question. */
export function resetCertificateQuestions(): void {
  pending.clear();
  inflight.clear();
  listeners.clear();
}

/** A certificate this device trusts at one address (`host:port`). */
export type SavedCertificate = Readonly<{address: string; fingerprint: string; serverId: string}>;

/** The https origin a saved `host:port` stands for (an IPv6 host in brackets). */
export function savedCertificateOrigin(address: string): string {
  const at = address.lastIndexOf(':');
  const host = address.slice(0, at), port = address.slice(at + 1);
  return `https://${host.includes(':') ? `[${host}]` : host}${port === '443' ? '' : `:${port}`}`;
}

/** Saved certificates as the device reports them; anything malformed is left out. */
export function parseSavedCertificates(raw: unknown): SavedCertificate[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v): SavedCertificate[] => {
    const r = v as Record<string, unknown> | null;
    if (!r || typeof r.address !== 'string' || !/^[^\s]+:\d{1,5}$/.test(r.address) || typeof r.fingerprint !== 'string' || !FINGERPRINT.test(r.fingerprint)) return [];
    return [{address: r.address, fingerprint: r.fingerprint, serverId: typeof r.serverId === 'string' ? r.serverId : ''}];
  });
}
