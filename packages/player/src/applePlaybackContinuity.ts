export type ApplePlaybackRoutePolicy = {
  allowInsecureLan: boolean;
};

export type ApplePlaybackContinuationCredential = {
  token: string;
  expiresAt: string;
  origin: string;
  generation: number;
};

export type ApplePlaybackDescriptor = {
  url: string;
  mediaGrant: string;
  sessionId: string;
  continuationURL: string;
  continuationCredential: ApplePlaybackContinuationCredential;
  nextEventSequence: number;
  playbackRevision: number;
  resumePositionSeconds: number;
  playbackGeneration: number;
  serverOrigins: readonly string[];
  routePolicy: ApplePlaybackRoutePolicy;
  revision: string;
};

export function validateApplePlaybackDescriptor(
  value: unknown,
): ApplePlaybackDescriptor {
  if (!isRecord(value)) throw new Error('Apple playback descriptor is not an object.');
  const descriptor = value as Partial<ApplePlaybackDescriptor>;
  const resumePositionSeconds = typeof descriptor.resumePositionSeconds === 'number' ? descriptor.resumePositionSeconds : NaN;
  const playbackGeneration = typeof descriptor.playbackGeneration === 'number' ? descriptor.playbackGeneration : NaN;
  const nextEventSequence = typeof descriptor.nextEventSequence === 'number' ? descriptor.nextEventSequence : NaN;
  const playbackRevision = typeof descriptor.playbackRevision === 'number' ? descriptor.playbackRevision : NaN;
  const continuationCredential = descriptor.continuationCredential as ApplePlaybackContinuationCredential | undefined;
  if (
    !nonEmpty(descriptor.url) ||
    !nonEmpty(descriptor.mediaGrant) ||
    !nonEmpty(descriptor.sessionId) ||
    !nonEmpty(descriptor.continuationURL) ||
    !isRecord(continuationCredential) ||
    !nonEmpty(continuationCredential.token) ||
    !nonEmpty(continuationCredential.expiresAt) ||
    !nonEmpty(continuationCredential.origin) ||
    !Number.isInteger(continuationCredential.generation) ||
    continuationCredential.generation !== playbackGeneration ||
    !Number.isFinite(Date.parse(continuationCredential.expiresAt)) ||
    Date.parse(continuationCredential.expiresAt) <= Date.now() ||
    !Number.isInteger(nextEventSequence) ||
    nextEventSequence < 1 ||
    !Number.isInteger(playbackRevision) ||
    playbackRevision < 0 ||
    !Number.isFinite(resumePositionSeconds) ||
    resumePositionSeconds < 0 ||
    !Number.isInteger(playbackGeneration) ||
    playbackGeneration < 0 ||
    !Array.isArray(descriptor.serverOrigins) ||
    descriptor.serverOrigins.length === 0 ||
    !descriptor.serverOrigins.every(nonEmpty) ||
    !isRecord(descriptor.routePolicy) ||
    typeof descriptor.routePolicy.allowInsecureLan !== 'boolean' ||
    !nonEmpty(descriptor.revision)
  ) {
    throw new Error('Apple playback descriptor is incomplete.');
  }
  if (!isAllowedPlaybackURL(descriptor.url, descriptor.serverOrigins, descriptor.routePolicy)) {
    throw new Error('Apple playback descriptor URL is outside the selected server origins.');
  }
  if (!isAllowedPlaybackURL(descriptor.continuationURL, descriptor.serverOrigins, descriptor.routePolicy)) {
    throw new Error('Apple playback continuation URL is outside the selected server origins.');
  }
  if (!isAllowedPlaybackURL(continuationCredential.origin, descriptor.serverOrigins, descriptor.routePolicy)) {
    throw new Error('Apple playback continuation origin is outside the selected server origins.');
  }
  const continuation = new URL(descriptor.continuationURL) as unknown as {pathname: string; search: string; hash: string; origin: string};
  const continuationOrigin = new URL(continuationCredential.origin) as unknown as {origin: string};
  const expectedPath = `/api/playback-sessions/${encodeURIComponent(descriptor.sessionId)}/continuation`;
  if (continuation.pathname !== expectedPath || continuation.search || continuation.hash ||
      continuation.origin.toLowerCase() !== continuationOrigin.origin.toLowerCase()) {
    throw new Error('Apple playback continuation URL is not the exact scoped session endpoint.');
  }
  return {
    url: descriptor.url,
    mediaGrant: descriptor.mediaGrant,
    sessionId: descriptor.sessionId,
    continuationURL: descriptor.continuationURL,
    continuationCredential,
    nextEventSequence,
    playbackRevision,
    resumePositionSeconds,
    playbackGeneration,
    serverOrigins: descriptor.serverOrigins,
    routePolicy: descriptor.routePolicy,
    revision: descriptor.revision,
  };
}

export function descriptorTransition(
  previous: ApplePlaybackDescriptor | undefined,
  next: unknown,
  terminalFailure = false,
): 'ignore' | 'update-grant' | 'replace-item' {
  const descriptor = validateApplePlaybackDescriptor(next);
  if (previous?.revision === descriptor.revision) return 'ignore';
  if (
    previous &&
    previous.url === descriptor.url &&
    previous.playbackGeneration === descriptor.playbackGeneration &&
    previous.serverOrigins.join('|') === descriptor.serverOrigins.join('|') &&
    !terminalFailure
  ) {
    return 'update-grant';
  }
  return 'replace-item';
}

export function rangeForCurrentOffset(
  currentOffset: number,
  requestedOffset: number,
  requestedLength: number,
  requestsAllDataToEnd: boolean,
): string | undefined {
  const start = Math.max(currentOffset, 0);
  if (requestsAllDataToEnd) return `bytes=${start}-`;
  const consumed = Math.max(0, start - requestedOffset);
  const remaining = Math.max(0, requestedLength - consumed);
  if (remaining === 0) return undefined;
  return `bytes=${start}-${start + remaining - 1}`;
}

export function sliceFromCurrentOffset(
  data: Uint8Array,
  currentOffset: number,
  requestsAllDataToEnd: boolean,
  requestedLength: number,
): Uint8Array {
  const start = Math.min(data.length, Math.max(0, currentOffset));
  const end = requestsAllDataToEnd
    ? data.length
    : Math.min(data.length, start + Math.max(0, requestedLength));
  return data.slice(start, end);
}

export function rewriteApprovedHLSPlaylist(
  source: string,
  serverOrigins: readonly string[],
  routePolicy: ApplePlaybackRoutePolicy,
  syntheticScheme = 'portico-resource',
): {body: string; contentLength: number; contentType: 'com.apple.mpegurl'; byteRangeSupported: false} {
  const body = source.replace(/https?:\/\/[^\s"']+/gi, value => {
    if (!isAllowedPlaybackURL(value, serverOrigins, routePolicy)) return value;
    const url = new URL(value) as unknown as {
      host: string;
      pathname: string;
      search: string;
      hash: string;
    };
    return `${syntheticScheme}://${url.host}${url.pathname}${url.search}${url.hash}`;
  });
  return {
    body,
    contentLength: utf8ByteLength(body),
    contentType: 'com.apple.mpegurl',
    byteRangeSupported: false,
  };
}

export function isAllowedPlaybackURL(
  value: string,
  serverOrigins: readonly string[],
  routePolicy: ApplePlaybackRoutePolicy,
): boolean {
  try {
    const url = new URL(value, 'https://portico.invalid') as unknown as {protocol: string; origin: string; hostname: string};
    if (url.protocol === 'http:' && (!routePolicy.allowInsecureLan || !isTrustedInsecureHost(url.hostname))) return false;
    if (!['http:', 'https:'].includes(url.protocol)) return value.startsWith('/api/');
    const origin = url.origin.toLowerCase();
    return serverOrigins.some(candidate => {
      try {
        return (new URL(candidate) as unknown as {origin: string}).origin.toLowerCase() === origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function isTrustedInsecureHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.startsWith('fe80:')) return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function utf8ByteLength(value: string): number {
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}/gi, 'x').length;
}

export type ApplePlaybackErrorLike = {
  code?: number | string;
  domain?: string;
  category?: string;
  status?: number;
  cause?: unknown;
  underlyingError?: unknown;
  userInfo?: {NSUnderlyingError?: unknown; underlyingError?: unknown};
};

export function classifyApplePlaybackError(error: unknown): 'grant' | 'route' | 'decoder' | 'configuration' | 'server-product' {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    const candidate = current as ApplePlaybackErrorLike;
    const status = candidate.status ?? (typeof candidate.code === 'number' ? candidate.code : undefined);
    if (
      status === 401 ||
      status === 403 ||
      candidate.category === 'grant' ||
      (candidate.domain === 'NSURLErrorDomain' &&
        [(-1012), (-1013)].includes(Number(candidate.code)))
    ) return 'grant';
    if (candidate.domain === 'AVAudioSessionErrorDomain') return 'configuration';
    if (candidate.domain === 'NSURLErrorDomain') return 'route';
    if (candidate.category === 'server-product') return 'server-product';
    current = candidate.cause ?? candidate.underlyingError ?? candidate.userInfo?.NSUnderlyingError ?? candidate.userInfo?.underlyingError;
  }
  return 'decoder';
}

export type AppleHeartbeatState = {
  sessionId: string;
  grantExpiresAt: number;
  nextSequence: number;
  lastAcknowledgedSequence: number;
};

export function heartbeatDue(state: AppleHeartbeatState, now: number, thresholdMs = 60_000): boolean {
  return state.grantExpiresAt - now <= Math.max(30_000, thresholdMs);
}

export function acknowledgeHeartbeat(state: AppleHeartbeatState, highestEventSequence: number): AppleHeartbeatState {
  return {
    ...state,
    lastAcknowledgedSequence: Math.max(state.lastAcknowledgedSequence, highestEventSequence),
    nextSequence: Math.max(state.nextSequence, highestEventSequence + 1),
  };
}

export function canCommitPreparedHandoff(
  currentSessionId: string,
  preparedSessionId: string,
  acceptedSessionId: string | undefined,
  preparedPlaybackRevision?: number,
  acceptedPlaybackRevision?: number,
): boolean {
  return Boolean(
    currentSessionId &&
      preparedSessionId &&
      acceptedSessionId === preparedSessionId &&
      (preparedPlaybackRevision === undefined || acceptedPlaybackRevision === preparedPlaybackRevision),
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
