import type {ArtworkSource} from './types';

export type ArtworkPreparation = Readonly<{
  /** Only the matching, mounted native Image's actual decode can resolve this wait. */
  wait: (signal?: AbortSignal) => Promise<void>;
  dispose: () => void;
}>;
type Waiter = {resolve: () => void; reject: (error: Error) => void};
type Record = {source: Pick<ArtworkSource, 'uri' | 'cacheKey'>; status: 'pending' | 'ready' | 'failed'; error?: Error; owner?: object; waiters: Set<Waiter>};
const records = new WeakMap<ArtworkPreparation, Record>();
const cancelled = () => Object.assign(new Error('Artwork preparation was cancelled.'), {name: 'AbortError'});

function settle(record: Record, error?: Error) {
  record.status = error ? 'failed' : 'ready';
  record.error = error;
  for (const waiter of [...record.waiters]) error ? waiter.reject(error) : waiter.resolve();
  record.waiters.clear();
}

/** No fetch, prefetch, hidden Image or cache shortcut: mount the one real incoming art layer. */
export function createArtworkPreparation(source: ArtworkSource): ArtworkPreparation {
  const record: Record = {source: {uri: source.uri, cacheKey: source.cacheKey}, status: 'pending', waiters: new Set()};
  const handle: ArtworkPreparation = Object.freeze({
    wait: (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {reject(cancelled()); return;}
      if (record.status === 'ready') {resolve(); return;}
      if (record.status === 'failed') {reject(record.error); return;}
      const cleanup = () => {record.waiters.delete(waiter); signal?.removeEventListener('abort', abort);};
      const waiter: Waiter = {resolve: () => {cleanup(); resolve();}, reject: error => {cleanup(); reject(error);}};
      const abort = () => waiter.reject(cancelled());
      record.waiters.add(waiter);
      signal?.addEventListener('abort', abort, {once: true});
    }),
    dispose: () => settle(record, cancelled()),
  });
  records.set(handle, record);
  return handle;
}

/** Internal native Image boundary; not exported through the component barrel. */
export function bindArtworkPreparation(handle: ArtworkPreparation | undefined, source: Pick<ArtworkSource, 'uri' | 'cacheKey'>) {
  if (!handle) return undefined;
  const record = records.get(handle);
  if (!record) throw new Error('Unknown artwork preparation.');
  if (record.source.cacheKey !== source.cacheKey || record.source.uri !== source.uri) {
    settle(record, new Error('Artwork preparation source changed.'));
    return undefined;
  }
  if (record.owner) throw new Error('Artwork preparation must belong to one image layer.');
  const owner = {};
  record.owner = owner;
  const owns = () => record.owner === owner;
  return {
    ready: () => {if (owns() && record.status === 'pending') settle(record);},
    failed: () => {if (owns()) settle(record, new Error('Artwork did not decode.'));},
    release: () => {if (owns()) {record.owner = undefined; settle(record, cancelled());}},
  };
}
