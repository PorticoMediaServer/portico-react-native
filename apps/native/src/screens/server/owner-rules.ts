import type {ApiScope, NewApiCredential, Webhook, WebhookChange, WebhookDelivery} from '../../../../../packages/client-core/src/api-access';
import {chosenScopes, expiryInstant, webhookAddressOk, type ExpiryDays} from '../../../../../packages/client-core/src/server-admin/api-words';
import type {RatingSystem} from '../../../../../packages/client-core/src/identity-restrictions';
import type {AttentionEntry} from '../../../../../packages/client-core/src/metadata-attention';
import {attentionOffers} from '../../../../../packages/client-core/src/server-admin/attention-words';
import type {MetadataSettings, MetadataSettingsChange} from '../../../../../packages/client-core/src/metadata-settings';
import type {Alert, Job} from '../../../../../packages/client-core/src/console';
import {contentRatings, type MemberLimits} from '../../../../../packages/client-core/src/server-administration';
import {keepReadable} from '../../../../../packages/client-core/src/tolerant';
import {isStaleAnswer} from '../../../../../packages/client-core/src/freshness-actions';

/**
 * The rules behind the owner's pages on phones and tablets and the television Dashboard: what a
 * form sends, what a list offers, and what is left out. No React and nothing drawn, so each rule
 * is tested on its own.
 */

// ── Keys and tokens ─────────────────────────────────────────────────────────

/**
 * What creating a key or token sends for the form as filled in, or nothing while it cannot be
 * sent: a name, at least one of the scopes this server offers ("Everything" alone when ticked),
 * and the moment it stops working, counted from when the form was first sent so a retry asks for
 * the same key.
 */
export function credentialRequest(form: Readonly<{name: string; ticked: ReadonlySet<ApiScope>; offered: readonly ApiScope[]; days: ExpiryDays; firstSentAt: number}>): Omit<NewApiCredential, 'operationId'> | undefined {
  const name = form.name.trim();
  const scopes = chosenScopes(form.ticked).filter(scope => form.offered.includes(scope));
  if (!name || !scopes.length) return undefined;
  const expiresAt = expiryInstant(form.days, form.firstSentAt);
  return {name, scopes, ...(expiresAt ? {expiresAt} : {})};
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export type WebhookDraft = Readonly<{name: string; url: string; events: readonly string[]; enabled: boolean; secret: string}>;
export const webhookDraft = (webhook?: Webhook): WebhookDraft => ({name: webhook?.name ?? '', url: webhook?.url ?? '', events: webhook?.events ?? [], enabled: webhook?.enabled ?? true, secret: ''});

/** Why a webhook cannot be saved yet: the first thing missing, or nothing. Only a bad address is said in words; the rest simply keep Save off. */
export function webhookDraftProblem(draft: WebhookDraft): 'name' | 'address' | 'addressInvalid' | 'events' | undefined {
  if (!draft.name.trim()) return 'name';
  if (!draft.url.trim()) return 'address';
  if (!webhookAddressOk(draft.url)) return 'addressInvalid';
  return draft.events.length ? undefined : 'events';
}

/** What an edit sends: only what the owner changed, so a field they did not touch is left as the server has it. Nothing when nothing changed. */
export function webhookChange(webhook: Webhook, draft: WebhookDraft): WebhookChange | undefined {
  const name = draft.name.trim(), url = draft.url.trim();
  const sameEvents = draft.events.length === webhook.events.length && draft.events.every(event => webhook.events.includes(event));
  const change: WebhookChange = {...(name !== webhook.name ? {name} : {}), ...(url !== webhook.url ? {url} : {}), ...(sameEvents ? {} : {events: draft.events}), ...(draft.enabled !== webhook.enabled ? {enabled: draft.enabled} : {})};
  return Object.keys(change).length ? change : undefined;
}

/** Ticks or unticks events, keeping the order they were chosen in and each once. */
export function withEvents(chosen: readonly string[], events: readonly string[], on: boolean): readonly string[] {
  return on ? [...new Set([...chosen, ...events])] : chosen.filter(event => !events.includes(event));
}

/**
 * The delivery log after a read. The first page read again leads, newest first, with the older
 * pages already shown kept under it; a further page is added below, without repeating a row.
 */
export function mergeDeliveries(shown: readonly WebhookDelivery[] | undefined, page: readonly WebhookDelivery[], further: boolean): readonly WebhookDelivery[] {
  if (further) return [...(shown ?? []), ...page.filter(d => !shown?.some(p => p.id === d.id))];
  const fresh = new Set(page.map(d => d.id));
  return [...page, ...(shown ?? []).filter(d => !fresh.has(d.id))];
}

// ── People ──────────────────────────────────────────────────────────────────

export type RatingChoices = Readonly<{
  /** The system the limit is a value of; undefined while it is a plain rating or none is chosen. */
  system?: RatingSystem;
  /** Whether a rating can be chosen at all (a system has to be chosen first where the server has systems). */
  open: boolean;
  /** The ratings on offer, lowest first: the system's own, or the plain list on a server without systems. */
  ratings: readonly Readonly<{code: string; label: string; minimumAge?: number}>[];
}>;

/**
 * The ratings an account's limit can be set to. Where the server publishes rating systems, the
 * limit is a system and then a rating in it. A limit saved before systems existed (a plain
 * rating with no system) stays shown as it is until changed, and the rating in force is always
 * among the choices, so opening the page never changes what is saved.
 */
export function ratingChoices(limits: Pick<MemberLimits, 'ratingSystem' | 'maxContentRating'>, systems: readonly RatingSystem[]): RatingChoices {
  const system = systems.find(s => s.id === limits.ratingSystem);
  const plain = !limits.ratingSystem && !!limits.maxContentRating;
  const offered = system ? system.values.map(v => ({code: v.code, label: v.label, minimumAge: v.minimumAge})) : !systems.length || plain ? contentRatings.map(code => ({code, label: code})) : [];
  const current = limits.maxContentRating && !offered.some(r => r.code === limits.maxContentRating) ? [{code: limits.maxContentRating, label: limits.maxContentRating}] : [];
  return {...(system ? {system} : {}), open: offered.length > 0, ratings: [...offered, ...current]};
}

/** A time of day as typed ("8", "8:30", "20.15", "0830"), in minutes from midnight; nothing for what is not a time. */
export function typedClock(text: string): number | undefined {
  const typed = text.trim();
  const parts = /^(\d{1,2})(?:[:.h ](\d{1,2}))?$/.exec(typed) ?? /^(\d{2})(\d{2})$/.exec(typed);
  if (!parts) return undefined;
  const hours = Number(parts[1]), minutes = Number(parts[2] ?? 0);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : undefined;
}

// ── Metadata ────────────────────────────────────────────────────────────────

/** A provider key as the owner edits it: left alone, replaced by what was typed, or removed so Portico's own is used again. */
export type KeyEdit = Readonly<{typed: string; remove: boolean}>;
export const keyUntouched: KeyEdit = {typed: '', remove: false};
/** What a key edit sends: '' removes the owner's key, text replaces it, undefined leaves it. */
export const keyChange = (edit: KeyEdit): string | undefined => (edit.remove ? '' : edit.typed.trim() ? edit.typed.trim() : undefined);

export type MetadataDraft = Readonly<{limitBytes: number; includeAdult: boolean; tmdb: KeyEdit; tvdb: KeyEdit}>;

/**
 * What saving the metadata settings sends against the document as the server has it now. `read`
 * is the document the draft was edited from. A setting the owner did not change takes the
 * server's value; one changed here and, differently, on the server is the one real conflict, and
 * nothing is sent for it.
 */
export function metadataSave(read: MetadataSettings, draft: MetadataDraft, now: MetadataSettings = read): MetadataSettingsChange | 'conflict' {
  const limitMine = draft.limitBytes !== read.localArtworkLimitBytes, adultMine = draft.includeAdult !== read.includeAdult;
  if (limitMine && now.localArtworkLimitBytes !== read.localArtworkLimitBytes && now.localArtworkLimitBytes !== draft.limitBytes) return 'conflict';
  if (adultMine && now.includeAdult !== read.includeAdult && now.includeAdult !== draft.includeAdult) return 'conflict';
  const tmdb = keyChange(draft.tmdb), tvdb = keyChange(draft.tvdb);
  return {expectedRevision: now.revision, localArtworkLimitBytes: limitMine ? draft.limitBytes : now.localArtworkLimitBytes, includeAdult: adultMine ? draft.includeAdult : now.includeAdult, ...(tmdb !== undefined ? {tmdbReadToken: tmdb} : {}), ...(tvdb !== undefined ? {tvdbProjectKey: tvdb} : {})};
}

export type AttentionChoice = 'search' | 'id' | 'parent' | 'dismiss';
/** What the owner can do with a title that needs attention besides using a suggested match: only what the server named for it, in the order shown. */
export function attentionChoices(entry: Pick<AttentionEntry, 'actions' | 'parentId'>): readonly AttentionChoice[] {
  return (['search', 'id', 'parent', 'dismiss'] as const).filter(choice => attentionOffers(entry, choice) && (choice !== 'parent' || !!entry.parentId));
}

// ── Live TV ─────────────────────────────────────────────────────────────────

export type ChannelMapEntry = Readonly<{channelId: string; name: string; sourceNumber: string; number: string; group: string; guideChannelId: string; hidden: boolean; overridden: boolean}>;
export type ChannelOverride = Readonly<{number: string; guideChannelId: string; hidden: boolean}>;

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** One page of a source's channels as the mapping list reads it. A channel that cannot be read is left out alone; the rest are kept. */
export function parseChannelMapPage(raw: unknown): Readonly<{items: readonly ChannelMapEntry[]; nextCursor: string}> {
  const page = raw as {items?: unknown; nextCursor?: unknown} | null;
  if (!page || !Array.isArray(page.items) || page.items.length > 1000) throw Object.assign(new Error('invalid_response'), {code: 'invalid_response'});
  const items = keepReadable('live-channel-map', 'items', page.items, (row): ChannelMapEntry => {
    const c = row as Record<string, unknown> | null;
    if (!c || typeof c !== 'object' || !text(c.channelId, 512) || !c.channelId || !text(c.name, 1024)) throw new Error('channel');
    return {channelId: c.channelId, name: c.name, sourceNumber: text(c.sourceNumber, 64) ? c.sourceNumber : '', number: text(c.number, 64) ? c.number : '', group: text(c.group, 512) ? c.group : '', guideChannelId: text(c.guideChannelId, 512) ? c.guideChannelId : '', hidden: c.hidden === true, overridden: c.overridden === true};
  });
  return {items, nextCursor: text(page.nextCursor, 2048) ? page.nextCursor : ''};
}

/** What the mapping shows for a channel: the owner's edit, else what is saved (a number only when it was set here, not the source's own). */
export const channelOverride = (channel: ChannelMapEntry, edits: Readonly<Record<string, ChannelOverride>>): ChannelOverride => edits[channel.channelId] ?? {number: channel.overridden ? channel.number : '', guideChannelId: channel.guideChannelId, hidden: channel.hidden};

/** The server takes at most this many channel changes in one request. */
export const CHANNEL_MAP_BATCH = 200;

/** The edits as the server takes them, in batches it accepts. */
export function channelMapBatches(edits: Readonly<Record<string, ChannelOverride>>): readonly (readonly Readonly<{channelId: string} & ChannelOverride>[])[] {
  const all = Object.entries(edits).map(([channelId, o]) => ({channelId, number: o.number.trim(), guideChannelId: o.guideChannelId.trim(), hidden: o.hidden}));
  const out: (typeof all)[] = [];
  for (let i = 0; i < all.length; i += CHANNEL_MAP_BATCH) out.push(all.slice(i, i + CHANNEL_MAP_BATCH));
  return out;
}

/**
 * Saves channel changes one batch after another, each against the revision the batch before it
 * left, starting from a freshly read one. A batch the server calls out of date is sent again
 * against the source as it is now. It stops at the first batch the server refuses for any other
 * reason and says how many changes were saved, so the rest stay on screen to be saved again.
 */
export async function saveChannelMap(edits: Readonly<Record<string, ChannelOverride>>, io: Readonly<{revision(): Promise<number>; put(revision: number, batch: readonly Readonly<{channelId: string} & ChannelOverride>[]): Promise<unknown>}>): Promise<Readonly<{saved: number; total: number; error?: unknown}>> {
  const batches = channelMapBatches(edits);
  const total = batches.reduce((n, batch) => n + batch.length, 0);
  let saved = 0;
  try {
    let revision = await io.revision();
    for (const batch of batches) {
      try { await io.put(revision, batch); } catch (error) {
        if (!isStaleAnswer(error)) throw error;
        // The source moved between two batches (a guide refresh, a setting saved elsewhere). What a channel is set to does not depend on that: the batch is sent once more against the source as it is now.
        revision = await io.revision().catch(() => { throw error; });
        await io.put(revision, batch);
      }
      saved += batch.length; revision += 1;
    }
  } catch (error) { return {saved, total, error}; }
  return {saved, total};
}

/** The edits still to save after `saved` of them went through, in the order they are sent. */
export function unsavedChannelEdits(edits: Readonly<Record<string, ChannelOverride>>, saved: number): Readonly<Record<string, ChannelOverride>> {
  return Object.fromEntries(Object.entries(edits).slice(saved));
}

/** Ticks or unticks one group or channel of a source; the order chosen is kept. */
export const withChoice = (chosen: readonly string[], id: string, on: boolean): readonly string[] => (on ? [...chosen.filter(x => x !== id), id] : chosen.filter(x => x !== id));

// ── The television Dashboard ────────────────────────────────────────────────

const WORKING: ReadonlySet<Job['state']> = new Set(['running', 'reconciling', 'cancellation-requested', 'queued', 'paused']);
const ORDER: Readonly<Record<string, number>> = {running: 0, reconciling: 0, 'cancellation-requested': 0, queued: 1, paused: 2};

/** Background work that is under way or waiting its turn (scans, rebuilds, conversions), what is running first; finished and failed work is not "in progress". */
export function workInProgress(jobs: readonly Job[], limit = 8): readonly Job[] {
  return jobs.filter(job => WORKING.has(job.state)).sort((a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3) || b.updatedAt - a.updatedAt).slice(0, limit);
}

export type RecentProblem = Readonly<{id: string; kind: 'alert'; alert: Alert; at: number} | {id: string; kind: 'job'; job: Job; at: number}>;

/**
 * What went wrong lately, newest first: what the server is still warning about, and background
 * work that failed within the last day. Something the owner already resolved is not a problem
 * any more.
 */
export function recentProblems(alerts: readonly Alert[], jobs: readonly Job[], now: number, limit = 6): readonly RecentProblem[] {
  const since = now - 24 * 3600 * 1000;
  const out: RecentProblem[] = [
    ...alerts.filter(alert => alert.status !== 'resolved').map(alert => ({id: 'alert:' + alert.id, kind: 'alert' as const, alert, at: alert.lastAt})),
    ...jobs.filter(job => job.state === 'failed' && job.updatedAt >= since).map(job => ({id: 'job:' + job.id, kind: 'job' as const, job, at: job.updatedAt})),
  ];
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

// ── A title's files, and titles that are one ────────────────────────────────

/** What an owner can do with one file of a title, in the order a menu lists it. */
export type FileTool = 'split' | 'delete';

/**
 * The tools offered for one of a title's files. Splitting is offered only for the kinds the
 * server can split (a film, a track, a book's file; never an episode, which is placed by show,
 * season and number), only for a file that is on disk, and only while the title has another
 * version to stay behind. Deleting the one file is always the owner's to ask for; the server's
 * preview then says whether the library allows it.
 */
export function fileTools(title: Readonly<{kind: string}>, file: Readonly<{available: boolean}>, files: number, splittable: readonly string[]): readonly FileTool[] {
  return [...(splittable.includes(title.kind) && file.available && files > 1 ? ['split' as const] : []), 'delete' as const];
}

const MERGE_GROUPS: Readonly<Record<string, 'movies' | 'shows' | 'episodes' | 'songs'>> = {movie: 'movies', show: 'shows', episode: 'episodes', song: 'songs'};
/** Where the other title of a merge is looked for: the search group of the same kind, or nothing for a kind that has none. */
export const mergeSearchGroup = (kind: string): 'movies' | 'shows' | 'episodes' | 'songs' | undefined => MERGE_GROUPS[kind];

/** Which of two titles goes into the other: `keep` stays, and the other's files and history join it. */
export function mergeOrder<T extends {id: string}>(a: T, b: T, keep: string): Readonly<{from: T; into: T}> {
  return keep === a.id ? {from: b, into: a} : {from: a, into: b};
}
