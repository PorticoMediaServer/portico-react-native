import type {DetailApi} from '../../../../../packages/client-core/src/detail';

/** The measured disc-title choices the server exposes for one physical version.
 * Only public facts: the asset's own version id and opaque selection ids. */
export type DiscTitleKind = 'bluray' | 'dvd';
export type DiscPackaging = 'iso' | 'folder';
export type DiscTitleOption = Readonly<{id: string; number: number; durationMs: number; chapterCount: number; main: boolean}>;
export type DiscTitles = Readonly<{versionId: string; revision: string; kind: DiscTitleKind; packaging: DiscPackaging; ready: boolean; titles: readonly DiscTitleOption[]}>;
export type DiscTitleWrite = Readonly<{itemId: string; versionId: string; revision: string; titleId: string}>;
export type DiscTitleLifetime = Readonly<{signal: AbortSignal; isCurrent: () => boolean}>;

/** Bound from disc.MaxTitles on the server, which refuses more than this. */
export const MAX_DISC_TITLES = 4096;
const ID = /^[0-9a-f]{8,128}$/u;

const fail = (): never => {throw new Error('invalid_disc_titles');};
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Only the named public fields are read; anything else the server sends is ignored. */
const closed = (value: unknown): Record<string, unknown> => record(value) ? value : fail();
const text = (value: unknown, max: number): string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value) ? value : fail();
const hex = (value: unknown): string => typeof value === 'string' && ID.test(value) ? value : fail();
const integer = (value: unknown, min: number, max: number): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail();

/** The GET /v1/items/{id}/disc-titles body, closed over the server's own fields. */
export function parseDiscTitles(raw: unknown, expectedVersionId: string): DiscTitles {
  const body = closed(raw);
  const versionId = text(body.versionId, 256), revision = text(body.revision, 128);
  if (versionId !== expectedVersionId) fail();
  const kind = body.kind === 'bluray' || body.kind === 'dvd' ? body.kind : fail();
  const packaging = body.packaging === 'iso' || body.packaging === 'folder' ? body.packaging : fail();
  if (typeof body.ready !== 'boolean' || !Array.isArray(body.titles) || body.titles.length > MAX_DISC_TITLES) fail();
  const seen = new Set<string>(), seenNumber = new Set<number>();
  const titles = body.titles.map((value): DiscTitleOption => {
    const title = closed(value);
    const id = hex(title.id), number = integer(title.number, 1, MAX_DISC_TITLES);
    if (seen.has(id) || seenNumber.has(number)) fail();
    seen.add(id); seenNumber.add(number);
    if (typeof title.main !== 'boolean') fail();
    return Object.freeze({id, number, durationMs: integer(title.durationMs, 0, Number.MAX_SAFE_INTEGER),
      chapterCount: integer(title.chapterCount, 0, 65535), main: title.main});
  });
  return Object.freeze({versionId, revision, kind, packaging, ready: body.ready, titles: Object.freeze(titles)});
}

const code = (error: unknown): string | undefined => {
  const value = (error as {code?: unknown} | null)?.code;
  return typeof value === 'string' ? value : undefined;
};
const current = (lifetime: DiscTitleLifetime) => !lifetime.signal.aborted && lifetime.isCurrent();

/** Owner read of the current choices for one physical version. The version is the
 * one the panel was opened with; a changed item or version never borrows it. */
export async function readDiscTitles(api: DetailApi, itemId: string, versionId: string, lifetime: DiscTitleLifetime): Promise<DiscTitles | undefined> {
  if (!current(lifetime)) return;
  const raw = await api.request<unknown>(`/v1/items/${encodeURIComponent(itemId)}/disc-titles?versionId=${encodeURIComponent(versionId)}`, undefined, undefined, lifetime.signal);
  if (!current(lifetime)) return;
  return parseDiscTitles(raw, versionId);
}

/** Owner write of the main title. It sends the revision it read, so a changed
 * structure refuses instead of moving someone else's choice. The 202 body is the
 * current choices with the choice applied and analysis not yet ready. */
export async function chooseDiscMainTitle(api: DetailApi, write: DiscTitleWrite, lifetime: DiscTitleLifetime): Promise<DiscTitles | undefined> {
  if (!current(lifetime)) return;
  try {
    const raw = await api.request<unknown>(`/v1/items/${encodeURIComponent(write.itemId)}/main-title`, 'PUT',
      {versionId: write.versionId, revision: write.revision, titleId: write.titleId}, lifetime.signal);
    if (!current(lifetime)) return;
    return parseDiscTitles(raw, write.versionId);
  } catch (error) {
    if (code(error) === 'revision_mismatch' || (error as {status?: number} | null)?.status === 412) {
      throw Object.assign(new Error('disc_titles_stale'), {code: 'disc_titles_stale'});
    }
    throw error;
  }
}
