import type {PageResult} from '../../../../packages/client-core/src/collections/index';
import {validateContentProjection, type ContentEntry, type ContentRoute, type ContentScope, type ContentSection, type LibraryContentApi} from '../../../../packages/client-core/src/library-content';

/** The content projection's page size (LibraryContentService's default); page 0 is the entity's own first page. */
export const SECTION_PAGE = 40;

/**
 * PERF-S03: one list section of an entity page (an album's or artist's songs, a book's chapters or
 * parts) as a windowed collection, so an artist with 5,000 songs or a 750k-song list costs what's on
 * screen. The content API pages a section by cursor (a section cursor answers exactly that section),
 * so page k needs page k−1's cursor: the source remembers every cursor it has seen and walks forward
 * from the nearest one. The store keeps only the pages near the viewport.
 */
export function sectionSource(api: LibraryContentApi, scope: ContentScope, route: ContentRoute, seed: Pick<ContentSection, 'id' | 'entries' | 'nextCursor' | 'totalCount'>) {
  const cursors = new Map<number, string | null>([[0, null], [1, seed.nextCursor || null]]);
  let total = seed.totalCount;
  const request = async (page: number, signal: AbortSignal) => {
    const cursor = cursors.get(page);
    const params = new URLSearchParams({view: route.view, limit: String(SECTION_PAGE)});
    if (route.entityId) params.set('entityId', route.entityId);
    if (cursor) params.set('cursor', cursor);
    const raw = await api.request<unknown>(`/v1/libraries/${encodeURIComponent(route.libraryId ?? "")}/content?${params}`, 'GET', undefined, signal);
    const projection = validateContentProjection(raw, route, scope, SECTION_PAGE);
    const section = projection.sections.find(s => s.id === seed.id) ?? projection.sections[0];
    cursors.set(page + 1, section?.nextCursor || null);
    if (section) {
      total = section.totalCount;
    }
    return section?.entries ?? [];
  };
  // The window asks for neighbouring pages in parallel, and each may need the same walk: one read
  // per page, shared while it's in flight and kept briefly (a bounded few), never repeated.
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
    if (page === 0) return {items: seed.entries, total};
    let known = page;
    while (!cursors.has(known)) known--;
    for (let k = known; k < page; k++) {
      if (k > 0 && cursors.get(k) === null) return {items: [], total};
      await once(k, signal);
    }
    if (cursors.get(page) === null) return {items: [], total};
    const items = await once(page, signal);
    return {items, total};
  };
}
