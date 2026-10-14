import type {FetchPage} from '../../../../packages/client-core/src/collections/index';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {parseBrowseResult, type BrowseNode, type BrowseRequestBody, type BrowseSortSelection} from '../../../../packages/client-core/src/browse';
import {bucketIndexFor} from '../../../../packages/client-core/src/browse-buckets';

export type Predicate = Extract<BrowseNode, {field: string}>;

type BrowseApi = {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>};
function sortValueFor(entry: ContentEntry, sortField: string): unknown {
  if (sortField === 'title') return (entry as {title?: unknown}).title;
  if (sortField === 'year') return (entry as {year?: unknown}).year;
  if (sortField === 'duration' || sortField === 'durationSeconds') return (entry as {duration?: unknown}).duration;
  if (['added', 'lastPlayed', 'addedAt', 'lastPlayedAt', 'dateAdded'].includes(sortField)) return (entry as {addedAt?: unknown}).addedAt;
  return undefined;
}

/**
 * Browse pages by offset pinned to the first page's revision, with bucket
 * re-anchoring for non-title sorts. Pure (no React/session) so node:test can exercise it.
 */
export function browsePageSource(api: BrowseApi, input: {libraryId: string; pivot: string; predicates: readonly Predicate[]; sort?: BrowseSortSelection; query?: BrowseNode; sorts?: readonly BrowseSortSelection[]}): FetchPage<ContentEntry> {
  const sortField = input.sorts?.[0]?.field ?? input.sort?.field ?? 'title';
  let revision: string | undefined;
  const firstEntries = new Map<number, ContentEntry>();
  const loadRange = async (start: number, count: number, signal: AbortSignal, rev: string | undefined) => {
    const body: BrowseRequestBody = {pivot: input.pivot, ...(input.sorts ? (input.query ? {query: input.query} : {}) : input.predicates.length ? {query: {all: input.predicates}} : {}), ...(input.sorts ? {sort: input.sorts} : input.sort ? {sort: [input.sort]} : {}), limit: count, range: {start, ...(rev ? {revision: rev} : {})}};
    return parseBrowseResult(await api.request<unknown>(`/v1/libraries/${encodeURIComponent(input.libraryId)}/browse`, 'POST', body, signal));
  };
  const toPage = (result: ReturnType<typeof parseBrowseResult>, start: number) => {
    if (result.entries.length) {
      firstEntries.set(start, result.entries[0]!);
      while (firstEntries.size > 20) firstEntries.delete(firstEntries.keys().next().value!);
    }
    const positionIndex: Record<string, number> = {};
    for (const anchor of result.positionIndex) positionIndex[anchor.key] = anchor.index;
    return {items: result.entries, total: result.pageInfo.total, totalIsLowerBound: result.pageInfo.totalIsLowerBound, positionIndex};
  };
  return async (start, count, signal) => {
    try {
      const result = await loadRange(start, count, signal, revision);
      revision ??= result.pageInfo.revision || undefined;
      return toPage(result, start);
    } catch (error) {
      const code = (error as {code?: unknown} | null)?.code;
      if (code === 'stale_continuation' && revision !== undefined && !signal.aborted) {
        const before = firstEntries.get(start);
        revision = undefined;
        if (sortField !== 'title' && before) {
          const freshFirst = await loadRange(0, count, signal, undefined);
          revision = freshFirst.pageInfo.revision || undefined;
          const freshTotal = freshFirst.pageInfo.total;
          const bucket = bucketIndexFor(freshFirst.positionIndex, sortField, sortValueFor(before, sortField));
          // An open-ended total ("10,000+") is not the end of the list: the position stays where it was.
          const target = bucket !== undefined ? bucket : freshFirst.pageInfo.totalIsLowerBound ? start : Math.min(start, Math.max(0, freshTotal - 1));
          if (target === 0) {
            if (freshFirst.entries.length) firstEntries.set(0, freshFirst.entries[0]!);
            return toPage(freshFirst, 0);
          }
          return toPage(await loadRange(target, count, signal, revision), target);
        }
        const result = await loadRange(start, count, signal, undefined);
        revision ??= result.pageInfo.revision || undefined;
        return toPage(result, start);
      }
      throw error;
    }
  };
}
