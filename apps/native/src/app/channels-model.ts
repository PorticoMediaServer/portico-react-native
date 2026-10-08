import {parseChannelGuide, type ChannelApi, type ChannelGuide, type GuideChannel, type GuideProgramme, type GuideRoute} from '../../../../packages/client-core/src/channel-guide';
import {HOUR_MS, MINUTE_MS, floorTo, legacyChannelRow, legacyProgram, type ChannelSource, type GuideChannelRow, type GuideDataSource, type GuideProgram} from '../../../../packages/client-core/src/guide/index';
import {defaultI18n} from '../../../../packages/i18n/src/index';
import type {IconName} from '../ui';

/**
 * The pure part of Channels (Spec — Channels and Guide §2, §8.1): the guide data source per entry,
 * the entries and where Channels opens, the per-source memory's shape, and the reminder list's
 * rules. No React and no native modules, so node tests cover it (test/channels-model.test.ts).
 */

export const ALL = 'all';
export const RECORDINGS = 'recordings';
export const LIBRARY = 'library';
export type ChannelView = 'guide' | 'list';
export type ChannelSort = 'number' | 'name';

export function localTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export type RawIndex = {channels: Map<string, GuideChannel>; programmes: Map<string, GuideProgramme>};
export const newRawIndex = (): RawIndex => ({channels: new Map(), programmes: new Map()});

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
function query(route: GuideRoute, cursor: string): string {
  const q = new URLSearchParams({kind: route.kind, start: route.start, end: route.end, timezone: route.timezone, search: route.search, sourceId: route.sourceId, limit: '30', cursor});
  if (route.favorites) q.set('favorites', 'true');
  if (route.includeHidden) q.set('includeHidden', 'true');
  if (route.group) q.set('group', route.group);
  return '/v1/guide?' + q.toString();
}
async function walk(api: ChannelApi, serverId: string, route: GuideRoute, signal?: AbortSignal): Promise<ChannelGuide[]> {
  const pages: ChannelGuide[] = [];
  let cursor = '';
  for (let i = 0; i < 200; i++) {
    const page = parseChannelGuide(await api.request<unknown>(query(route, cursor), 'GET', undefined, signal), serverId, route);
    pages.push(page);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return pages;
}

export type GuideQuery = Readonly<{entry: string; timezone: string; group?: string; favorites?: boolean; includeHidden?: boolean; sort: ChannelSort}>;

/** The kinds and source filter behind a Channels entry. */
function parts(entry: string): {kind: 'live-source' | 'library-channel'; sourceId: string}[] {
  if (entry === ALL) return [{kind: 'live-source', sourceId: ''}, {kind: 'library-channel', sourceId: ''}];
  if (entry === LIBRARY) return [{kind: 'library-channel', sourceId: ''}];
  return [{kind: 'live-source', sourceId: entry}];
}

const byNumber = (a: GuideChannelRow, b: GuideChannelRow) => {
  const na = parseFloat(a.number), nb = parseFloat(b.number);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1;
  return a.name.localeCompare(b.name);
};

/** The §8.1 stopgap for one Channels entry: walks today's cursor pages per 3-hour block (≤ 100 channels). */
export function channelGuideSource(api: ChannelApi, serverId: string, q: GuideQuery, raw: RawIndex, now: () => number = Date.now): GuideDataSource {
  const kinds = parts(q.entry);
  const route = (kind: 'live-source' | 'library-channel', sourceId: string, start: number, end: number): GuideRoute => ({
    kind, start: iso(start), end: iso(end), timezone: q.timezone, search: '', sourceId,
    ...(q.favorites ? {favorites: true} : {}), ...(q.includeHidden ? {includeHidden: true} : {}), ...(q.group ? {group: q.group} : {}),
  });
  const windows = new Map<string, Promise<ChannelGuide[]>>();
  const window = (start: number, end: number) => {
    const key = `${start}:${end}`;
    let pages = windows.get(key);
    if (!pages) {
      // One walk per window for every channel page that asks; not tied to one caller's abort.
      pages = Promise.all(kinds.map(k => walk(api, serverId, route(k.kind, k.sourceId, start, end)).catch(e => { if (kinds.length > 1) return [] as ChannelGuide[]; throw e; }))).then(all => all.flat());
      windows.set(key, pages);
      pages.catch(() => windows.delete(key));
      while (windows.size > 8) windows.delete(windows.keys().next().value!);
    }
    return pages.then(list => {
      for (const page of list) for (const c of page.channels) { raw.channels.set(c.id, c); for (const p of c.programmes) raw.programmes.set(p.id, p); }
      return list;
    });
  };
  let list: Promise<GuideChannelRow[]> | undefined;
  return {
    async channels(from, limit, signal) {
      if (!list) {
        const start = floorTo(now(), HOUR_MS);
        list = window(start, start + 3 * HOUR_MS).then(pages => {
          // Sources in the owner's order, each in its own sort; by name interleaves (§2.2).
          const rows = pages.flatMap(p => p.channels.map(legacyChannelRow));
          const seen = new Set<string>();
          const unique = rows.filter(r => !seen.has(r.id) && seen.add(r.id));
          if (q.sort === 'name') return unique.sort((a, b) => a.name.localeCompare(b.name) || byNumber(a, b));
          const order = new Map<string, number>();
          unique.forEach(r => { if (!order.has(r.sourceId ?? '')) order.set(r.sourceId ?? '', order.size); });
          return unique.sort((a, b) => (order.get(a.sourceId ?? '')! - order.get(b.sourceId ?? '')!) || byNumber(a, b));
        });
        list.catch(() => { list = undefined; });
      }
      const all = await list;
      if (signal.aborted) throw new Error('aborted');
      return {items: all.slice(from, from + limit), total: all.length};
    },
    async programs(channelIds, start, end, signal) {
      const pages = await window(start, end);
      if (signal.aborted) throw new Error('aborted');
      const wanted = new Set(channelIds);
      const out: Record<string, GuideProgram[]> = {};
      for (const id of channelIds) out[id] = [];
      for (const page of pages) for (const c of page.channels) if (wanted.has(c.id)) out[c.id] = c.programmes.map(legacyProgram);
      return out;
    },
  };
}

/** Rail and picker entries (§2.0): All channels with 2+ sources, each source, Recordings when a live source records. */
export type ChannelEntry = Readonly<{id: string; name: string; icon: IconName; library: boolean}>;
export function channelEntries(sources: readonly ChannelSource[]): ChannelEntry[] {
  const t = defaultI18n.t;
  if (!sources.length) return [];
  const out: ChannelEntry[] = [];
  if (sources.length >= 2) out.push({id: ALL, name: t('channels.all'), icon: 'grid', library: false});
  // Live sources get the neutral channels glyph, never their type; Library Channels their own mark
  // (`library` until the `libraryChannel` glyph is drawn, §2.0a).
  for (const s of sources) out.push({id: s.id, name: s.type === 'library' ? t('channels.custom.name') : s.name, icon: s.type === 'library' ? 'library' : 'channels', library: s.type === 'library'});
  if (sources.some(s => s.recordAvailable)) out.push({id: RECORDINGS, name: t('channels.recordings'), icon: 'dvr', library: false});
  return out;
}
/** Channels opens on All channels when there are 2+ sources, else the only source (Justin, 23 Sep). */
export const defaultEntry = (sources: readonly ChannelSource[]) => (sources.length >= 2 ? ALL : sources[0]?.id ?? ALL);

/** The owner's name for a source (Library Channels by its one catalogue name), for All channels row labels. */
export function sourceName(sources: readonly ChannelSource[], id: string | undefined): string {
  if (id === LIBRARY) return defaultI18n.t('channels.custom.name');
  return sources.find(s => s.id === id)?.name ?? '';
}

// ── Per-source memory (on the device until the preference registry has `channels.view.*`) ──

export type ChannelMemory = {views: Record<string, ChannelView>; sorts: Record<string, ChannelSort>};
/** A stored memory, keeping only known values (a damaged or older record reads as empty). */
export function parseChannelMemory(raw: unknown): ChannelMemory {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ChannelMemory>;
  const pick = <T extends string>(o: unknown, ok: readonly T[]) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => ok.includes(v as T))) as Record<string, T>;
  return {views: pick<ChannelView>(r.views, ['guide', 'list']), sorts: pick<ChannelSort>(r.sorts, ['number', 'name'])};
}
/** The memory after choosing a view or sort for one entry; at most 50 entries of each are kept (newest last). */
export function rememberChoice(m: ChannelMemory, entry: string, choice: {view?: ChannelView; sort?: ChannelSort}): ChannelMemory {
  const put = <T,>(o: Record<string, T>, v: T | undefined) => { if (v === undefined) return o; const {[entry]: _old, ...rest} = o; return Object.fromEntries(Object.entries({...rest, [entry]: v}).slice(-50)) as Record<string, T>; };
  return {views: put(m.views, choice.view), sorts: put(m.sorts, choice.sort)};
}

// ── Reminders (§3.5 "Remind me", decision 3: in-app only, per profile on this device) ──

export type Reminder = Readonly<{programId: string; channelId: string; title: string; channelName: string; start: number}>;
export const REMINDER_LEAD_MS = 2 * MINUTE_MS;
/** Well-formed reminders that haven't passed (5 minutes' grace), at most 100. */
export function liveReminders(list: readonly unknown[], now = Date.now()): Reminder[] {
  return (list.filter(r => !!r && typeof (r as Reminder).programId === 'string' && typeof (r as Reminder).start === 'number' && (r as Reminder).start > now - 5 * MINUTE_MS) as Reminder[]).slice(-100);
}
/** The list with `r` added, or removed when it was already there. */
export function toggledReminders(list: readonly Reminder[], r: Reminder, now = Date.now()): {list: Reminder[]; on: boolean} {
  const on = list.some(x => x.programId === r.programId);
  return {list: liveReminders(on ? list.filter(x => x.programId !== r.programId) : [...list, r], now), on: !on};
}

// ── FEAT-01: when the server itself can't play channels ──

/** Reasons that belong to the whole server, not to one channel (the web Live screen's FEAT-01 set). */
export type ServerWideReason = 'platform' | 'tools' | 'delivery';
export function serverWideReason(reason: string | undefined): ServerWideReason | null {
  switch (reason) {
    case 'decoder_confinement_unavailable': return 'platform';
    case 'ffmpeg_not_configured': case 'ffprobe_not_configured': case 'decoder_dependencies_unavailable': return 'tools';
    case 'delivery-unavailable': case 'delivery_unavailable': case 'channel_runtime_unavailable': return 'delivery';
    default: return null;
  }
}
/**
 * The server-wide reason when every channel is unavailable for one (so Channels explains it once and
 * doesn't mark each channel), else null. With mixed reasons the most basic one wins
 * (platform, then tools, then delivery). Built on the reason codes, never on their wording.
 */
export function serverWideUnavailable(channels: readonly GuideChannelRow[]): ServerWideReason | null {
  if (!channels.length || channels.some(c => c.tuneAvailable)) return null;
  const reasons = new Set(channels.map(c => serverWideReason(c.tuneUnavailableReason)));
  if (reasons.has(null)) return null;
  return reasons.has('platform') ? 'platform' : reasons.has('tools') ? 'tools' : 'delivery';
}
