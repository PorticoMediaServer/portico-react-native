import type {ImageURISource} from 'react-native';
import {
  normalizeViewerScope,
  viewerCacheKey,
  type LocalServerSession,
  type ViewerScope,
} from '@portico/client-core';
import {
  getServerSession,
  serverSessionEnvironmentMatches,
} from './clientEnvironment';

const PRIVATE_ARTWORK_CACHE_QUERY = '__portico_viewer';
const PRIVATE_ARTWORK_CACHE_CONTRACT =
  'portico-react-native-private-artwork-v2';
let privateArtworkCacheEpoch = 0;

/**
 * Rotates the native image URL namespace at a viewer transition. React Native
 * image loaders key their cache by URL and do not reliably include request
 * headers in that key, so a new viewer must never reuse the previous URL.
 */
export function rotatePrivateArtworkCacheKey(): void {
  privateArtworkCacheEpoch =
    (privateArtworkCacheEpoch + 1) % 4_294_967_296;
}

export function privateArtworkCacheKey(scope: ViewerScope): string {
  const canonical = viewerCacheKey({
    ...normalizeViewerScope(scope),
    contractRevision: PRIVATE_ARTWORK_CACHE_CONTRACT,
    parameters: {epoch: privateArtworkCacheEpoch},
    resource: 'image',
  });
  return `v${privateArtworkCacheEpoch}-${stableHash(canonical, 0x811c9dc5)}${stableHash(canonical, 0x9e3779b9)}`;
}

/**
 * Builds a React Native image source for a server or public resource.
 *
 * Portico artwork is private and the server deliberately rejects credentials
 * in query parameters. The native image loader does not share fetch headers,
 * so same-origin API resources must receive the current server-scoped bearer
 * credential explicitly. Credentials are never attached to a different
 * origin, even when an external image URL came from a server response.
 */
export function serverImageSource(
  uri: string | undefined,
  session: LocalServerSession | undefined = getServerSession(),
): ImageURISource | undefined {
  if (!uri) return undefined;

  const resolvedUri = resolveServerResource(uri, session?.apiBaseUrl);
  const privateResource = Boolean(
    session?.apiBaseUrl
      ? isPrivateServerResource(resolvedUri, session.apiBaseUrl)
      : isApiResource(resolvedUri),
  );

  // A same-origin API image is private by contract. If its complete viewer
  // identity or active credential environment is unavailable, do not hand the
  // native loader a bare URL that could hit a prior viewer's cached response.
  if (privateResource) {
    const token = session?.accessToken;
    const scope = viewerScopeFromSession(session);
    if (!token || !scope || !serverSessionEnvironmentMatches(scope)) {
      return undefined;
    }
    const rekeyedUri = rekeyPrivateArtworkResource(
      resolvedUri,
      privateArtworkCacheKey(scope),
    );
    if (!rekeyedUri) return undefined;
    return {
      headers: {Authorization: `Bearer ${token}`},
      uri: rekeyedUri,
    };
  }

  // A one-time Hosted bootstrap is valid only for the server-session exchange;
  // it must never be attached to artwork or any other ordinary API resource.
  return {uri: resolvedUri};
}

function resolveServerResource(uri: string, apiBaseUrl: string | undefined): string {
  if (!apiBaseUrl) return uri;
  try {
    return new URL(uri, apiBaseUrl).toString();
  } catch {
    return uri;
  }
}

function isPrivateServerResource(uri: string, apiBaseUrl: string): boolean {
  try {
    const server = new URL(apiBaseUrl) as URL & {origin: string};
    const resource = new URL(uri, server) as URL & {origin: string; pathname: string};
    return resource.origin === server.origin && resource.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function isApiResource(uri: string): boolean {
  try {
    const resource = new URL(uri, 'https://portico.invalid') as URL & {
      pathname: string;
    };
    return resource.pathname.startsWith('/api/');
  } catch {
    return uri.trim().startsWith('/api/');
  }
}

function viewerScopeFromSession(
  session: LocalServerSession | undefined,
): ViewerScope | undefined {
  if (!session) return undefined;
  const candidate = session as LocalServerSession & {
    hostedAccountId?: string;
  };
  try {
    return normalizeViewerScope({
      accountId: candidate.accountId ?? candidate.hostedAccountId ?? '',
      authority:
        candidate.authority ??
        (candidate.hostedAccountId ? 'hosted' : 'local'),
      authorizationRevision: candidate.authorizationRevision ?? '',
      profileId: candidate.profileId ?? '',
      serverId: candidate.serverId ?? '',
    });
  } catch {
    return undefined;
  }
}

function rekeyPrivateArtworkResource(
  uri: string,
  cacheKey: string,
): string | undefined {
  try {
    const components = new URL(uri) as URL & {
      hash: string;
      searchParams: {set(name: string, value: string): void};
    };
    components.searchParams.set(PRIVATE_ARTWORK_CACHE_QUERY, cacheKey);
    components.hash = '';
    return components.toString();
  } catch {
    return undefined;
  }
}

function stableHash(value: string, seed: number): string {
  const modulus = 4_294_967_296;
  let hash = seed % modulus;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 0x01000193) + value.charCodeAt(index)) % modulus;
    if (hash < 0) hash += modulus;
  }
  return Math.trunc(hash).toString(16).padStart(8, '0');
}
