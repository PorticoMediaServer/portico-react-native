import {RouteError} from '../../../../packages/client-core/src/route-identity.ts';

/**
 * Apple's rule for plain HTTP (App Transport Security): the app may use it only on the local
 * network, and every other address must use HTTPS. The Info.plist allows local networking (IP
 * addresses, unqualified names, `.local`) and the private home names `.home.arpa`, `.internal`
 * and `.lan`; this keeps the app's own rule to addresses that really are local, and says so
 * plainly instead of failing with a network error:
 *  - loopback, private IPv4 (10/8, 172.16/12, 192.168/16), link-local, and the shared address
 *    space 100.64/10 that Tailscale and other overlays use;
 *  - IPv6 loopback, link-local (fe80::/10) and unique local (fc00::/7);
 *  - a name with no dot, or ending in `.local`, `.home.arpa`, `.internal` or `.lan`.
 */
export function localPlainHttpHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  if (host.includes(':')) {
    if (host === '::1') return true;
    return /^fe[89ab][0-9a-f]?:/.test(host) || /^f[cd][0-9a-f]{0,2}:/.test(host);
  }
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ip) {
    const [a, b] = ip.slice(1, 3).map(Number);
    if (ip.slice(1).some(n => Number(n) > 255)) return false;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host === 'localhost' || !host.includes('.')) return true;
  return /\.(local|home\.arpa|internal|lan)$/.test(host);
}

/** Throws the plain explanation when Apple would refuse a plain HTTP request to this URL. */
export function checkApplePlainHttp(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol === 'http:' && !localPlainHttpHost(parsed.hostname)) {
    throw new RouteError('plain_http_remote', 'On Apple devices, plain HTTP works only on your home network. Use this server’s https:// address.');
  }
}
