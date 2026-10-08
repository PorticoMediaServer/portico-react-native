import type {DetailProjection} from '../../../../../packages/client-core/src/detail';

export type EpisodeCredit = DetailProjection['metadata']['credits'][number];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 1024): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const id = (value: unknown): value is string => text(value, 256) && /^[A-Za-z0-9_-]+$/.test(value);

function creditPage(raw: unknown, itemId: string): {credits: EpisodeCredit[]; total: number; nextCursor?: string} {
  if (!object(raw) || raw.group !== 'cast' || !Number.isSafeInteger(raw.total) || Number(raw.total) < 0 || !Array.isArray(raw.credits) || raw.credits.length > 10000 || raw.nextCursor !== undefined && !text(raw.nextCursor, 4096)) throw new Error('Invalid cast credits page.');
  const credits = raw.credits.map(row => {
    if (!object(row) || !id(row.id) || !text(row.name) || !text(row.role) || !text(row.department) || !id(row.provider) || row.personId !== undefined && !id(row.personId) || row.portraitUrl !== undefined && (!text(row.portraitUrl) || !row.portraitUrl.startsWith('/v1/metadata/item/' + encodeURIComponent(itemId) + '/art/portrait?') || /[\\\r\n]/.test(row.portraitUrl))) throw new Error('Invalid cast credit.');
    return row as EpisodeCredit;
  });
  return {credits, total: raw.total as number, ...(raw.nextCursor ? {nextCursor: raw.nextCursor as string} : {})};
}

/** Fetch the episode's complete cast in server billing order for the See all strip. */
export async function loadEpisodeCast(
  api: {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>},
  itemId: string,
  signal?: AbortSignal,
): Promise<readonly EpisodeCredit[]> {
  const credits: EpisodeCredit[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const path = `/v1/items/${encodeURIComponent(itemId)}/credits?group=cast` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const page = creditPage(await api.request<unknown>(path, 'GET', undefined, signal), itemId);
    credits.push(...page.credits);
    if (credits.length >= page.total) return credits;
    if (!page.credits.length || !page.nextCursor || seenCursors.has(page.nextCursor)) throw new Error('Cast credits ended before the reported total.');
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
