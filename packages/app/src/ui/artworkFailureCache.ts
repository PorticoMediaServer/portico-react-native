import {registerViewerArtworkResetter} from '@portico-react-native/infrastructure';

export const ARTWORK_FAILURE_TTL_MS = 30_000;
export const MAX_REMEMBERED_ARTWORK_FAILURES = 512;

type ArtworkFailureRecord = {
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Keys are the complete image source URI. Private sources are re-keyed by
 * the infrastructure layer with an opaque viewer/credential namespace before
 * they reach this cache, so a failure for one viewer cannot suppress another
 * viewer's artwork.
 */
const failures = new Map<string, ArtworkFailureRecord>();
const listeners = new Set<() => void>();
let version = 0;

function notifyChange(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function expireArtworkFailure(
  source: string,
  record: ArtworkFailureRecord,
): void {
  if (failures.get(source) !== record) return;
  failures.delete(source);
  notifyChange();
}

export function rememberMediaArtworkFailure(uri: string | undefined): number {
  if (!uri) return 0;
  const previous = failures.get(uri);
  if (previous) clearTimeout(previous.timer);
  const record: ArtworkFailureRecord = {
    expiresAt: Date.now() + ARTWORK_FAILURE_TTL_MS,
    timer: setTimeout(
      () => expireArtworkFailure(uri, record),
      ARTWORK_FAILURE_TTL_MS,
    ),
  };
  failures.delete(uri);
  failures.set(uri, record);
  while (failures.size > MAX_REMEMBERED_ARTWORK_FAILURES) {
    const oldest = failures.keys().next().value as string | undefined;
    if (!oldest) break;
    const oldestRecord = failures.get(oldest);
    if (oldestRecord) clearTimeout(oldestRecord.timer);
    failures.delete(oldest);
  }
  notifyChange();
  return record.expiresAt;
}

export function mediaArtworkFailureExpiresAt(uri: string | undefined): number {
  if (!uri) return 0;
  const expiresAt = failures.get(uri)?.expiresAt ?? 0;
  return expiresAt > Date.now() ? expiresAt : 0;
}

export function clearMediaArtworkFailureCache(): void {
  if (!failures.size) return;
  for (const record of failures.values()) clearTimeout(record.timer);
  failures.clear();
  notifyChange();
}

export function subscribeMediaArtworkFailureCache(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function mediaArtworkFailureCacheVersion(): number {
  return version;
}

// Register once at module load so a viewer transition evicts old private
// failure records before the next viewer can render artwork.
registerViewerArtworkResetter(clearMediaArtworkFailureCache);
