import {useEffect, useMemo, useSyncExternalStore} from 'react';
import {createWindowedCollection, type PageResult, type WindowedCollection} from '../../../../packages/client-core/src/collections/index';
import {validateContentProjection, type ContentEntry, type ContentScope, type LibraryContentApi} from '../../../../packages/client-core/src/library-content';
import {viewerScope} from './viewer-scope';
import {useSession} from './session';

/** The show workspace's episode page size; the workspace's own first page seeds page 0. */
export const EPISODE_PAGE = 40;

export type EpisodeSelection = {libraryId: string; showId: string; seasonId: string | null; group?: string};
/** The first page the workspace already read, so opening a season costs no extra request. */
export type EpisodeSeed = {entries: readonly ContentEntry[]; nextCursor: string | null; total: number};

/**
 * Spec — Title Pages §2: a season's episodes as a windowed collection (never the whole season up
 * front). Today's show workspace pages by cursor, not offset, so page k needs page k−1's cursor:
 * the source remembers every cursor it has seen and walks forward from the nearest one when a page
 * further ahead is asked for (a "Jump to"). The store keeps only the pages near the viewport.
 * When lane B's offset/range episode pages land, only this function changes (deferred-to-contract).
 */
export function episodeSource(api: LibraryContentApi, scope: ContentScope, where: EpisodeSelection, seed?: EpisodeSeed) {
  const cursors = new Map<number, string | null>([[0, null]]);
  let total = seed?.total;
  if (seed) cursors.set(1, seed.nextCursor);
  const request = async (page: number, signal: AbortSignal) => {
    const cursor = cursors.get(page);
    const params = new URLSearchParams({showId: where.showId, limit: String(EPISODE_PAGE), seasonLimit: '1'});
    if (where.seasonId) params.set('seasonId', where.seasonId);
    if (where.group) params.set('group', where.group);
    if (cursor) params.set('cursor', cursor);
    const raw = await api.request<{episodes?: unknown}>(`/v1/libraries/${encodeURIComponent(where.libraryId)}/show-workspace?${params}`, 'GET', undefined, signal);
    const projection = validateContentProjection(raw?.episodes, {libraryId: where.libraryId, view: where.seasonId ? 'season' : 'show', entityId: where.seasonId ?? where.showId, sort: 'episode', direction: 'asc', category: '', q: ''}, scope, EPISODE_PAGE);
    const section = projection.sections[0];
    cursors.set(page + 1, section?.nextCursor || null);
    if (section) total = section.totalCount;
    return section?.entries ?? [];
  };
  // Parallel neighbouring pages share one read per page (see app/section-source.ts).
  const reads = new Map<number, Promise<readonly ContentEntry[]>>();
  const once = (page: number, signal: AbortSignal) => {
    let read = reads.get(page);
    if (!read) {
      read = request(page, signal);
      reads.set(page, read);
      read.catch(() => reads.delete(page));
      while (reads.size > 8) reads.delete(reads.keys().next().value!);
    }
    return read;
  };
  return async (start: number, count: number, signal: AbortSignal): Promise<PageResult<ContentEntry>> => {
    const page = Math.floor(start / count);
    if (page === 0 && seed) return {items: seed.entries, total: seed.total};
    let known = page;
    while (!cursors.has(known)) known--;
    for (let k = known; k < page; k++) {
      if (k > 0 && cursors.get(k) === null) return {items: [], total: total ?? start};
      await once(k, signal);
    }
    if (page > 0 && cursors.get(page) === null) return {items: [], total: total ?? start};
    const items = await once(page, signal);
    return {items, total: total ?? items.length};
  };
}

/** One collection per show + season (+ seed); disposed when any of them changes. */
export function useEpisodeWindow(where: EpisodeSelection | null, seed: EpisodeSeed | undefined) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const key = where ? JSON.stringify(where) : '';
  const list = useMemo<WindowedCollection<ContentEntry> | null>(
    () => (where && seed ? createWindowedCollection<ContentEntry>({fetchPage: episodeSource(api, scope, where, seed), pageSize: EPISODE_PAGE, maxResidentPages: 5, keyOf: e => e.id}) : null),
    // The seed belongs to the selection it came with; a new workspace read brings a new seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, scope, key, seed],
  );
  useEffect(() => () => list?.dispose(), [list]);
  const subscribe = useMemo(() => (listener: () => void) => list?.subscribe(listener) ?? (() => {}), [list]);
  const snapshot = useSyncExternalStore(subscribe, () => list?.getSnapshot() ?? idle);
  return {list, snapshot};
}
const idle = Object.freeze({generation: 0, total: undefined, status: 'idle' as const, error: undefined as unknown, positionIndex: undefined, refreshing: false});
