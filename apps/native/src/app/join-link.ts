/**
 * A server's invitation link (Spec — Hosted at Scale): `portico://join#code=<code>&server=<origin>`,
 * the app route for `https://web.getportico.tv/join#code=…&server=…`. The code is held in memory
 * only (never in navigation state, storage or logs) until the join screen takes it.
 */
export type JoinLink = Readonly<{code: string; server: string}>;

const validCode = (code: string) => /^[A-Za-z0-9_-]{32,128}$/.test(code);
function validServer(server: string): boolean {
  try {
    const url = new URL(server);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname && !url.username && !url.password && (url.pathname === '' || url.pathname === '/') && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function parseJoinLink(url: string): JoinLink | undefined {
  const m = /^portico:\/\/join\/?#(.+)$/.exec(url);
  if (!m) return undefined;
  const pairs = new Map<string, string>();
  for (const part of m[1].split('&')) {
    const at = part.indexOf('=');
    if (at < 1) return undefined;
    try { pairs.set(part.slice(0, at), decodeURIComponent(part.slice(at + 1))); } catch { return undefined; }
  }
  const code = pairs.get('code') ?? '', server = (pairs.get('server') ?? '').replace(/\/+$/, '');
  return pairs.size === 2 && validCode(code) && validServer(server) ? {code, server} : undefined;
}

/** How long a held invitation waits for its screen: long enough to create an account first. */
export const JOIN_LINK_LIFETIME_MS = 30 * 60 * 1000;

let held: {link: JoinLink; at: number} | undefined;
// A link handled once is not offered again (the sign-in flow and the shell are both told of it).
const handled = new Set<string>();
/** Holds a join link for the join screen; returns whether it was one (and not already handled). */
export function holdJoinLink(url: string, now: number = Date.now()): boolean {
  const link = parseJoinLink(url);
  if (!link || handled.has(link.code)) return false;
  held = {link, at: now};
  return true;
}
/** The invitation waiting for its screen, or undefined: none, or it waited too long and is forgotten. */
export function heldJoinLink(now: number = Date.now()): JoinLink | undefined {
  if (held && now - held.at > JOIN_LINK_LIFETIME_MS) held = undefined;
  return held?.link;
}
export function releaseJoinLink(): void { if (held) handled.add(held.link.code); held = undefined; }

/** An old Portico Account invitation (`portico://invite#invite=…`): those belonged to account
 * memberships, which servers now own; the person asks for a new invitation. */
export const isLegacyInvite = (url: string) => /^portico:\/\/invite\/?#/.test(url);
