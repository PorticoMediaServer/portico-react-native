import {type ChannelApi, type GuideChannel, type GuideProgramme} from '../../../../packages/client-core/src/channel-guide';
import {MINUTE_MS, legacyGuideSource, legacyChannel, legacyProgramme, type ChannelSource, type GuideChannelRow, type GuideDataSource} from '../../../../packages/client-core/src/guide/index';
import {dedupedGuideApi} from '../../../../packages/client-core/src/guide/reads';
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

export type GuideQuery = Readonly<{entry:string;timezone:string;group?:string;favorites?:boolean;includeHidden?:boolean;sort:ChannelSort}>;

/** Native screens use the same bounded directory/programme adapter as the web. */
export function channelGuideSource(api:ChannelApi,serverId:string,q:GuideQuery,raw:RawIndex,now:()=>number=Date.now):GuideDataSource {
 const source=legacyGuideSource(dedupedGuideApi(api),serverId,{kind:q.entry===ALL?'all':q.entry===LIBRARY?'library-channel':'live-source',sourceId:q.entry===ALL||q.entry===LIBRARY?'':q.entry,timezone:q.timezone,sort:q.sort,now,...(q.group?{group:q.group}:{}),...(q.favorites?{favorites:true}:{}),...(q.includeHidden?{includeHidden:true}:{})});
 return {
  reset(){raw.channels.clear();raw.programmes.clear();source.reset?.();},
  async neighbor(channel,delta,signal){
   const row=await source.neighbor?.(channel,delta,signal);
   if(row){const native=legacyChannel(row);if(native){raw.channels.delete(row.id);raw.channels.set(row.id,native);}}
   while(raw.channels.size>300)raw.channels.delete(raw.channels.keys().next().value!);
   return row;
  },
  async channels(from,limit,signal){
   const page=await source.channels(from,limit,signal);
   for(const row of page.items){const native=legacyChannel(row);if(native){raw.channels.delete(row.id);raw.channels.set(row.id,native);}}
   while(raw.channels.size>300)raw.channels.delete(raw.channels.keys().next().value!);
   return page;
  },
  async programs(ids,start,end,signal){
   const rows=await source.programs(ids,start,end,signal);
   for(const programmes of Object.values(rows))for(const programme of programmes){const native=legacyProgramme(programme);if(native){raw.programmes.delete(programme.id);raw.programmes.set(programme.id,native);}}
   while(raw.programmes.size>10000)raw.programmes.delete(raw.programmes.keys().next().value!);
   return rows;
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
  const put = <T,>(o: Record<string, T>, v: T | undefined) => { if (v === undefined) return o; const rest = {...o}; delete rest[entry]; return Object.fromEntries(Object.entries({...rest, [entry]: v}).slice(-50)) as Record<string, T>; };
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
