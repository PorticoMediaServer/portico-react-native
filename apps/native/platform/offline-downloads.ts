import type {NativeOfflinePublicationLease} from './offline-reading-authority';
import {publicationUTF8, openOfflineReadingSession, publicationBinding, nativePublicationReadsAvailable, type OfflineReadingSession, type PublicationBinding} from './offline-reading';
import {decodeGetReadingSessionsSessionIdProgressResponse, decodePutReadingSessionsSessionIdProgressResponse} from '../../../packages/contracts/src';
import type {ReadingLocation, ReadingProgress, ReadingSavedProgress} from '../../../packages/client-core/src/reading';
import {storedSubtitle, subtitleExtraFiles, type StoredSubtitle} from './offline-subtitle-files';
import {receiptTime, serverReceiptFloor} from './receipt-clock';
import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {nativeRouteCrypto} from '../src-next/platform/server-connections';
import {
  DownloadsService, parseDownloadBundle, decodeDownloadReceipt, downloadTitleLines, getDownloadRequest, parseDeferredProgressReceipt, parseDownloadTitle, parseReceiptKeys, parseReceiptOutcomes, receiptUsable,
  type DeferredProgressEntry, type DownloadBundle, type DownloadPreparation, type DownloadReceipt, type DownloadTitle, type ReceiptOutcome,
} from '../../../packages/client-core/src/index';
import {serviceText} from '../../../packages/client-core/src/presentation/service-text';
import {durationIntent} from '../../../packages/client-core/src/wire-units';
import type {MessageId} from '../../../packages/i18n/src/index';
import type {LocalMedia, LocalProgress} from './local-playback';

/** Downloads kept on this phone or tablet.
 *
 * The native module moves, verifies and stores files. This decides what may be played: a file
 * is playable offline only while it holds a receipt the server signed for this exact viewer,
 * and only until that receipt expires (the server renews it for another 30 days whenever the
 * app is online).
 *
 * A copy on this device is the viewer's until they remove it or the server's owner takes their
 * access away. The server tidying up — its own copy running out its time, the file being
 * replaced, the title leaving the library — never removes it; a title that has left the server
 * is shown as such and still plays.
 *
 * Everything a download needs comes with it and is kept beside it: what it is and where it sits
 * in its show, album or book, its description, artwork, chapters, skip markers, audio tracks and
 * subtitles. Nothing on the Downloads list asks the server for anything.
 *
 * A transfer continues from where it stopped, by itself: after a dropped connection, a wait for
 * Wi-Fi, the app being closed, or the address it was fetched from running out.
 *
 * Each play made offline is remembered and sent to the server later, which records it like any
 * other play and keeps whatever is newer. */

export type OfflineState = 'downloading' | 'paused' | 'failed' | 'ready';
/** Why a download that should be moving is not. */
export type OfflineWaiting = '' | 'wifi' | 'network';
/** What a receipt's verification covers: its key, signed payload and signature. */
const signedIdentity = (r: DownloadReceipt) => `${r.keyId}\u0000${r.payload}\u0000${r.signature}`;

/** The most receipts the server renews in one request. */
const RECEIPT_BATCH = 100;
/** The most pages of a container request's members (100 each) read in one pass. */
const ENROLL_PAGES_PER_PASS = 50;
/** The most members left waiting to be collected before more of a container request is read. They
 * are kept in the bookkeeping document, which the device refuses to save past a megabyte. */
const ENROLL_BACKLOG = 5000;
/** Receipts are renewed once a day at most. Renewal is also how this device learns that access
 * was withdrawn, so it is not left to the month a receipt lasts. */
const RENEW_EVERY_MS = 24 * 60 * 60 * 1000;
/** The most offline plays kept unsent for one viewer; past it the oldest are let go. */
const MAX_PLAYS = 400;
/** The least time between two automatic attempts at the same stopped download. */
const RETRY_EVERY_MS = 30 * 1000;
/** Stops that mend themselves: the app tries again without being asked. */
const RETRYABLE = new Set(['network', 'grant_expired', 'transfer_failed', 'server_refused']);
/** A play counts as finished for this device's own rules (remove after watching, next episode)
 * when the file ended or was stopped this far in. What the server makes of it is the server's. */
const FINISHED_AT = 0.92;

export type OfflineEntry = Readonly<{
  id: string; itemId: string; title: string; subtitle: string; quality: string;
  /** The poster or cover kept with the download (a file on this device), or ''. */
  artworkUrl: string;
  state: OfflineState; error: string; waiting: OfflineWaiting;
  /** The person paused it. Anything else that is paused or stopped did so by itself, and is
   * started again without being asked. */
  held: boolean;
  bytes: number; bytesDone: number; addedAt: number;
  receipt?: DownloadReceipt; libraryId?: string; kind?: string;
  /** Owner recorded natively when the transfer started, for entries with no receipt yet. */
  owner?: string;
  /** What the download is of, as the server last described it. */
  info?: DownloadTitle;
  /** False once the server has said the title is no longer in its library. */
  onServer: boolean;
  /** The server now holds a different file for this title. This copy still plays. */
  changedOnServer: boolean;
}>;
export type OfflineSettings = Readonly<{wifiOnly: boolean; deleteWatched: boolean; autoNext: boolean; limitBytes: number}>;
export type OfflinePlayabilityReason = 'sign_in'|'not_finished'|'needs_setup'|'needs_check_in'|'other_profile';
export type OfflineEntryFacts = Readonly<{
  /** The viewer's item bookmark, not a per-artifact observation or a completion flag. */
  resumePositionSeconds?: number;
  backdropUrl?: string;
  /** Actual cached bundle facts, never a resolution inferred from a quality ID. */
  media?: Readonly<{container?:string;videoCodec?:string;audioCodec?:string;width?:number;height?:number}>;
}>;
/** Display-only facts of a downloaded publication. The format comes from the signed
 * receipt; the position is this viewer's private Reading record. Neither grants a read. */
export type OfflineReadingFacts = Readonly<{
  format: PublicationBinding['format'];
  pageCount?: number;
  location?: ReadingLocation;
}>;
export type OfflineSnapshot = Readonly<{supported: boolean; ready: boolean; entries: readonly OfflineEntry[]; settings: OfflineSettings; freeBytes: number; usedBytes: number; /** Actual OS total capacity of the download volume; omitted when the native module does not report it. */ totalBytes?: number; /** Logical regular-file bytes in the entire app-owned Downloads tree (all viewers, including partial files/extras). Symlinks contribute no logical target bytes. */ storedBytes?: number; /** Actual OS allocated blocks in that tree, including directories and symlinks' own reported allocation, counted once per inode. Link targets are never traversed. */ allocatedBytes?: number; pendingProgress: number; /** Space taken by other viewers' downloads on this device. */ otherBytes: number; error?: string}>;
export type Viewer = Readonly<{authority: string; accountId: string; profileId: string; serverId: string}>;
type Api = {baseUrl: string; mediaUrl(path: string): string; request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>};
type Play = DeferredProgressEntry;
export type OfflineDisplay = Readonly<{title: string; subtitle?: string; artworkUrl?: string; libraryId?: string; kind?: string}>;
/** What the player is given beside the file: everything that came with the download. Subtitle
 * files are on this device. */
export type OfflineExtras = Readonly<{
  bundle?: DownloadBundle;
  subtitles: readonly StoredSubtitle[];
  backdropUrl: string;
  /** The scrubbing preview sheets as files on this device, in order; empty unless every one is here. */
  trickplayTiles?: readonly string[];
  /** Chapter thumbnails as files on this device, by the chapter's index. */
  chapterImages?: Readonly<Record<number, string>>;
}>;

/** What is kept with a native entry besides its bytes. `claim` is the server's claim for the
 * download when that is no longer the entry's own id; `token` is the address it is fetched from;
 * `extras` are the files saved beside it; `bundle` is `BUNDLE_COMPLETE` once everything that
 * travels with it is here, 1 while some of it is still to come. */
/** Raised when what is kept beside a download changes (3: a VobSub index is kept as `.idx`; 4:
 * chapter thumbnails and scrubbing previews come too), so a download marked complete under an
 * earlier rule is completed again by the next pass. */
const BUNDLE_COMPLETE = 4;
/** The names a download's previews are kept under beside it. */
const trickplayTileName = (tile: number) => `trickplay-${tile}`;
const chapterImageName = (index: number) => `chapter-${index}`;
type Meta = {
  libraryId?: string; kind?: string; owner?: string; receipt?: DownloadReceipt; title?: DownloadTitle;
  onServer?: boolean; changed?: boolean; claim?: string; token?: string; extras?: string[]; bundle?: number; publication?: boolean;
};

/** Deferred work is filed under the viewer that produced it, never under whoever is signed in
 * when it is finally sent. */
type Owned<T> = Record<string, Record<string, T>>;
type ReadingPending = Readonly<{id: string; observedAt: number; startedAt: number; location: ReadingLocation}>;
type ReadingRecord = Readonly<{itemId: string; sourceId: string; revision: string; documentSha256: string; artifactSha256: string; artifactBytes: number;
  receipt: DownloadReceipt; serverRevision: number; progress: ReadingProgress; pending?: ReadingPending; blockedStartedAt?: number}>;
type Stored = {
  reading: Owned<ReadingRecord>;
  version: 3;
  settings: OfflineSettings;
  /** Plays made offline and not yet accepted by the server, by play id. */
  plays: Owned<Play>;
  resume: Owned<number>;
  keys: Record<string, string>;
  wanted: Owned<OfflineDisplay>;
  wantedPublications: Owned<OfflineDisplay>;
  nextAfter: Owned<{quality: string; libraryId?: string; kind?: string}>;
  /** When each viewer's receipts were last renewed. */
  renewed: Record<string, number>;
  /** B-14.21: the receipt clock's floor (receipt-clock.ts): never earlier than the latest time trusted. */
  clockFloor: number;
};

const native = NativeModules.PorticoDownloads as undefined | {
  list(): Promise<any[]>; start(request: Record<string, unknown>): Promise<any>; pause(id: string): Promise<void>; remove(id: string): Promise<void>;
  setMeta(id: string, meta: string): Promise<void>; setMetas(metas: Record<string, string>): Promise<void>;
  storage(): Promise<{freeBytes: number; usedBytes: number; totalBytes?: number; storedBytes?: number; allocatedBytes?: number}>; setCellular(allowed: boolean): Promise<void>;
  readState(): Promise<string>; writeState(json: string): Promise<void>;
  localFile(id: string): Promise<{url: string; durationSeconds: number}>;
  writeExtra(id: string, name: string, text: string): Promise<void>; readExtra(id: string, name: string): Promise<string>;
  /** 'saved', 'missing' (the server has none for this title), 'later' or 'invalid'. */
  fetchExtra(id: string, name: string, url: string): Promise<string>;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const defaults: OfflineSettings = Object.freeze({wifiOnly: true, deleteWatched: false, autoNext: false, limitBytes: 0});
const random = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const operationId = () => 'op_' + random();

/** One viewer on one server. Every local record and every native entry is filed
 * under this exact string, so "the same account on a different server" and "a
 * different profile on the same account" are different owners. */
export const offlineOwnerKey = (viewer: Viewer) =>
  JSON.stringify([viewer.authority, viewer.accountId, viewer.profileId, viewer.serverId]);

const safeInteger = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
function signedPublication(receipt: DownloadReceipt): PublicationBinding {
  const signed = decodeDownloadReceipt(receipt).signedBytes;
  if (signed.length > 32768) throw new Error('reading_unavailable');
  const raw: unknown = JSON.parse(decodeURIComponent(Array.from(signed, byte => '%' + byte.toString(16).padStart(2, '0')).join('')));
  if (!object(raw)) throw new Error('reading_unavailable'); return publicationBinding(raw.publication);
}
function storedReading(raw: unknown): Owned<ReadingRecord> {
  const out: Owned<ReadingRecord> = {}; if (!object(raw)) return out;
  for (const [owner, values] of Object.entries(raw)) {
    if (!object(values)) continue;
    for (const [id, value] of Object.entries(values).slice(0, 2048)) try {
      if (!object(value) || typeof value.itemId !== 'string' || typeof value.sourceId !== 'string' || typeof value.revision !== 'string' || typeof value.documentSha256 !== 'string' || typeof value.artifactSha256 !== 'string' || !safeInteger(value.artifactBytes, 1) || value.artifactBytes > 2 ** 31 || !safeInteger(value.serverRevision)) continue;
      const receipt = decodeDownloadReceipt(value.receipt).receipt, binding = signedPublication(receipt);
      if (offlineOwnerKey(receipt.claims.viewer) !== owner || receipt.claims.itemId !== value.itemId || receipt.claims.artifact.sha256 !== value.artifactSha256 || receipt.claims.artifact.bytes !== value.artifactBytes || binding.sourceId !== value.sourceId || binding.revision !== value.revision || binding.documentSha256 !== value.documentSha256) continue;
      const progress = decodeGetReadingSessionsSessionIdProgressResponse(value.progress), p = progress.progress;
      if (p && (p.sourceId !== value.sourceId || !safeInteger(p.revision, 1) || !safeInteger(p.observedAt, 1))) continue;
      let pending: ReadingPending | undefined;
      if (value.pending !== undefined) {
        const offered = value.pending;
        if (!object(offered) || typeof offered.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(offered.id) || !safeInteger(offered.observedAt, 1) || !safeInteger(offered.startedAt, 1) || offered.startedAt > offered.observedAt || !p || !object(offered.location)) continue;
        const location = offered.location, actual = p.location;
        if (location.format !== actual.format || location.cfi !== actual.cfi || location.section !== actual.section || location.pageIndex !== actual.pageIndex || location.progression !== actual.progression) continue;
        pending = Object.freeze({id: offered.id, observedAt: offered.observedAt, startedAt: offered.startedAt, location: actual});
      }
      if (value.blockedStartedAt !== undefined && !safeInteger(value.blockedStartedAt, 1)) continue;
      bucket(out, owner)[id] = Object.freeze({itemId: value.itemId, sourceId: value.sourceId, revision: value.revision, documentSha256: value.documentSha256, artifactSha256: value.artifactSha256, artifactBytes: value.artifactBytes,
        receipt, serverRevision: value.serverRevision, progress, ...(pending ? {pending} : {}), ...(typeof value.blockedStartedAt === 'number' ? {blockedStartedAt: value.blockedStartedAt} : {})});
    } catch { /* A corrupt record is not a location or a queued observation. */ }
  }
  return out;
}
const emptyStored = (): Stored => ({version: 3, reading: {}, settings: defaults, plays: {}, resume: {}, keys: {}, wanted: {}, wantedPublications: {}, nextAfter: {}, renewed: {}, clockFloor: 0});

/** Reads the bookkeeping document. One written by an earlier layout keeps its settings and the
 * server's keys; the rest of it was shaped for a different contract and is not carried over. */
function readStored(parsed: any): Stored {
  const out = emptyStored();
  if (!parsed || typeof parsed !== 'object') return out;
  out.settings = {...defaults, ...(parsed.settings ?? {})};
  out.keys = parsed.keys ?? {};
  if (parsed.version !== 3) return out;
  out.plays = parsed.plays ?? {};
  out.reading = storedReading(parsed.reading);
  out.resume = parsed.resume ?? {};
  out.wanted = parsed.wanted ?? {};
  out.wantedPublications = {};
  if (object(parsed.wantedPublications)) for (const [owner, values] of Object.entries(parsed.wantedPublications)) {if (!object(values)) continue; const target = bucket(out.wantedPublications, owner);
    for (const [id, value] of Object.entries(values)) {if (object(value) && typeof value.title === 'string' && (value.kind === 'ebook' || value.kind === 'comic')) target[id] = {title: value.title, kind: value.kind, ...(typeof value.subtitle === 'string' ? {subtitle: value.subtitle} : {}), ...(typeof value.libraryId === 'string' ? {libraryId: value.libraryId} : {})};}}
  out.nextAfter = parsed.nextAfter ?? {};
  out.renewed = parsed.renewed ?? {};
  out.clockFloor = typeof parsed.clockFloor === 'number' && Number.isFinite(parsed.clockFloor) ? parsed.clockFloor : 0;
  return out;
}

const bucket = <T,>(owned: Owned<T>, owner: string): Record<string, T> => (owned[owner] ??= {});
export const offlineFailure = (code: string) => (code ? serviceText((['grant_expired', 'server_refused', 'verification_failed', 'storage_full', 'network', 'transfer_failed'].includes(code) ? 'downloads.failure.' + code : 'downloads.failure.other') as MessageId) : '');
export const offlineWaiting = (waiting: OfflineWaiting) => (waiting ? serviceText(('downloads.waiting.' + waiting) as MessageId) : '');

/** Whether a refused renewal means this viewer's own file must go.
 *
 * A refusal is the server saying this viewer may no longer play the title: downloads were turned
 * off for the profile, the account was switched off, the title or its library was closed to them,
 * or the receipt was withdrawn. The two answers that are not that are `unknown_receipt` and
 * `unknown_preparation`: the server has no record of what was asked about (a different profile's
 * receipt looks exactly like this, and so does a server restored from an older backup), which says
 * nothing about the copy and is never grounds for deleting it. */
const revokesOwnedFile = (code: string) => code !== '' && code !== 'unknown_receipt' && code !== 'unknown_preparation';

export class OfflineDownloads {
  private state: OfflineSnapshot = Object.freeze({supported: !!native && !Platform.isTV, ready: false, entries: [], settings: defaults, freeBytes: 0, usedBytes: 0, pendingProgress: 0, otherBytes: 0});
  private listeners = new Set<() => void>();
  /** Everything on the device. `state.entries` is the subset the connected
   * viewer may see; this is the list ownership decisions are made against. */
  private all: OfflineEntry[] = [];
  /** What is kept with each entry, as last read from the device. */
  private metas = new Map<string, Meta>();
  /** Each entry's folder on this device, as the native module reported it this launch. */
  private dirs = new Map<string, string>();
  private stored: Stored = emptyStored();
  /** Receipts whose signature verified, by their signed content (key, payload, signature), never
   * by receipt id alone: a renewed or replaced receipt under the same id is verified again. */
  private verified = new Set<string>();
  private subscriptions: {remove(): void}[] = [];
  private api?: Api; private service?: DownloadsService; private viewer?: Viewer;
  private receiving = new Set<string>();
  private unfollow?: () => void;
  private collecting = new Set<string>();
  /** Per container request, the reading of its members past the first page: the member the next
   * page starts after, how many have been read, the counts the request had at the last look, and
   * whether the last page was reached (it is read again, from the same place, when they change). */
  private enrolled = new Map<string, {after: string; read: number; mark: string; tail: boolean; busy: boolean; retryAt: number}>();
  private enrollTimer?: ReturnType<typeof setTimeout>;
  /** Members already enrolled, once each: a download deleted later (by hand or after watching)
   * is not wanted again because its request is still followed. */
  private enrolledItems = new Set<string>();
  private continuing = new Set<string>();
  /** Bumped by every connect and disconnect. Work started under an earlier
   * generation may finish, but may not write anything back. */
  private generation = 0;
  private opening?: Promise<void>;
  private receiptSync?: {generation: number; owner: string; forced: boolean; task: Promise<void>};
  private progressSync?: {generation: number; task: Promise<void>};
  /** When each stopped download was last tried again by itself. */
  private retried = new Map<string, number>();
  private tending?: ReturnType<typeof setInterval>;
  private bundling = new Set<string>();
  /** The play under way for each entry (one id for as long as the file stays open). */
  private playing = new Map<string, string>();
  private observationTimes = new Map<string, number>();

  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<OfflineSnapshot>) { this.state = Object.freeze({...this.state, ...patch}); this.listeners.forEach(f => f()); }

  /** Who this download belongs to, or undefined when nothing on the device says.
   *
   * A receipt is the server's signed statement of ownership, so it wins over the
   * locally recorded owner. The signature itself is checked separately, by
   * `playable`: an unverified receipt still tells us which server and viewer to
   * talk to, which is all this is used for. */
  private entryOwner(entry: OfflineEntry): string | undefined {
    if (entry.receipt) return offlineOwnerKey(entry.receipt.claims.viewer);
    return entry.owner || undefined;
  }
  private ownerKey() { return this.viewer ? offlineOwnerKey(this.viewer) : undefined; }
  /** Entries belonging to one owner. Nothing else may be renewed, submitted or removed for it. */
  private ownedEntries(owner: string) { return this.all.filter(e => this.entryOwner(e) === owner); }

  /** What the connected viewer may see: their own downloads. With no viewer connected the
   * device list is not published at all. */
  private visibleEntries(): OfflineEntry[] {
    const owner = this.ownerKey();
    return owner ? this.ownedEntries(owner) : [];
  }
  private publishEntries(next = this.all) {
    this.all = sort(next);
    const owner = this.ownerKey();
    // Other viewers' downloads are never named, only weighed: the space they take is this
    // device's, and whoever is using it can see it and give it back.
    let otherBytes = 0;
    for (const e of this.all) if (this.entryOwner(e) !== owner) otherBytes += e.state === 'ready' ? e.bytes : e.bytesDone;
    this.publish({entries: this.visibleEntries(), otherBytes: owner ? otherBytes : 0});
  }

  /** Reads what is on the device. Works with no server and no sign-in. */
  open(): Promise<void> {
    if (!native || !this.state.supported || this.state.ready) return Promise.resolve();
    if (!this.opening) this.opening = this.readDevice().finally(() => { this.opening = undefined; });
    return this.opening;
  }
  private async readDevice(): Promise<void> {
    if (!native) return;
    try {
      const raw = await native.readState();
      this.stored = readStored(raw ? JSON.parse(raw) : {});
    } catch { this.stored = emptyStored(); }
    const emitter = new NativeEventEmitter(NativeModules.PorticoDownloads);
    this.subscriptions.push(emitter.addListener('PorticoDownloadChanged', entry => this.accept(entry)));
    const entries = (await native.list()).map(raw => this.read(raw)).filter((e): e is OfflineEntry => !!e);
    this.all = sort(entries);
    this.publish({ready: true, settings: this.stored.settings});
    this.publishEntries();
    void this.measure();
    await this.verifyAll();
  }
  /** Names the viewer these downloads belong to, without binding a server.
   *
   * This is the half of `connect` that works with no network: it decides which
   * entries are listed and whose receipts are checked for playback. A cold
   * offline launch restores the saved viewer through this, so the downloads
   * screen shows that viewer's files and only theirs. */
  adopt(viewer: Viewer | undefined) {
    const next = viewer && offlineOwnerKey(viewer);
    if (next === (this.viewer && offlineOwnerKey(this.viewer))) return;
    // An offline adoption/sign-out also invalidates online work immediately.
    this.disconnect();
    this.viewer = viewer;
    // Cold auth screens need the device list before their downloads route exists.
    if (viewer) void this.open().catch(() => this.publish({error: serviceText('downloads.deviceUnreadable')}));
    this.publishEntries();
    this.publish({pendingProgress: this.pendingCount()});
  }
  /** Binds the signed-in server, so receipts can be renewed and offline viewing sent up. */
  connect(api: Api, service: DownloadsService, viewer: Viewer) {
    this.adopt(viewer);
    const generation = ++this.generation;
    this.api = api; this.service = service;
    this.unfollow?.(); this.unfollow = service.subscribe(() => void this.collect());
    // While the server is bound, what stopped by itself is tried again, what is still moving has
    // its address kept alive, and what is still missing its extras is completed.
    clearInterval(this.tending); this.tending = setInterval(() => void this.tend(generation), 60 * 1000);
    void this.open().then(async () => {
      if (this.generation !== generation) return;
      const owner = offlineOwnerKey(viewer);
      await this.refreshKeys(generation, api);
      if (this.generation !== generation) return;
      this.publishEntries();
      this.publish({pendingProgress: this.pendingCount()});
      void this.renewReceipts(generation, api, owner, false);
      void this.syncProgress(generation);
      void this.syncReadingProgress(generation);
      void this.collect();
      void this.continueNext(generation);
      void this.tend(generation);
    });
  }
  /** The app came to the front, or the network changed: look again now rather than at the next tick. */
  wake() { if (this.api) void this.tend(this.generation); }
  /** Drops the server binding while preserving the saved viewer for authorized
   * offline access. Sign-out clears it explicitly through `adopt(undefined)`. */
  disconnect() { this.generation++; this.unfollow?.(); this.unfollow = undefined; this.api = undefined; this.service = undefined; clearInterval(this.tending); this.tending = undefined; }
  dispose() { this.disconnect(); clearTimeout(this.enrollTimer); this.enrollTimer = undefined; this.subscriptions.forEach(s => s.remove()); this.subscriptions = []; this.listeners.clear(); clearInterval(this.tending); }

  private read(raw: any): OfflineEntry | undefined {
    if (!raw || typeof raw.id !== 'string' || !['downloading', 'paused', 'failed', 'ready'].includes(raw.state)) return undefined;
    let meta: Meta = {}; try { meta = raw.meta ? JSON.parse(raw.meta) : {}; } catch {}
    let receipt: DownloadReceipt | undefined;
    // A stored receipt is re-parsed every time it is read: a damaged one is no receipt at all.
    try { receipt = meta.receipt ? decodeDownloadReceipt(meta.receipt).receipt : undefined; } catch { receipt = undefined; }
    let info: DownloadTitle | undefined;
    // Meta.title is the internal model serialized by transfer/patch, not an API response.
    try { info = meta.title ? parseDownloadTitle(durationIntent({...meta.title}, {durationSeconds: 'durationMs'})) : undefined; } catch { info = undefined; }
    const dir = typeof raw.dir === 'string' ? raw.dir : this.dirs.get(raw.id) ?? '';
    if (dir) this.dirs.set(raw.id, dir);
    this.metas.set(raw.id, {...meta, receipt, title: info});
    const lines = info ? downloadTitleLines(info) : undefined;
    const art = (meta.extras ?? []).find(name => name === 'poster' || name === 'cover');
    return Object.freeze({
      id: raw.id, itemId: String(raw.itemId ?? ''), title: lines?.title || String(raw.title ?? ''), subtitle: lines?.subtitle ?? String(raw.subtitle ?? ''), quality: String(raw.quality ?? ''),
      artworkUrl: art && dir ? dir + 'extras/' + art : '',
      state: raw.state, error: String(raw.error ?? ''), waiting: raw.waiting === 'wifi' || raw.waiting === 'network' ? raw.waiting : '', held: raw.intent === 'hold',
      bytes: Number(raw.bytes) || 0, bytesDone: Number(raw.bytesDone) || 0, addedAt: Number(raw.addedAt) || 0, receipt,
      libraryId: meta.libraryId || undefined, kind: info?.kind || meta.kind || undefined,
      owner: typeof meta.owner === 'string' && meta.owner ? meta.owner : undefined,
      info, onServer: meta.onServer !== false, changedOnServer: meta.changed === true,
    });
  }
  private accept(raw: any) {
    if (raw?.state === 'removed') { this.metas.delete(raw.id); this.dirs.delete(raw.id); this.publishEntries(this.all.filter(e => e.id !== raw.id)); void this.measure(); return; }
    const before = this.all.find(e => e.id === raw?.id);
    const next = this.read(raw); if (!next) return;
    this.publishEntries([...this.all.filter(e => e.id !== next.id), next]);
    // A new or renewed receipt is verified by its own signed content (never inherited by id).
    if (next.receipt && (!before?.receipt || signedIdentity(before.receipt) !== signedIdentity(next.receipt))) void this.verifyAll();
    if (next.state === 'ready' && before?.state !== 'ready') {
      void this.measure();
      // The receipt was asked for before the first byte moved; this is for the one that could
      // not be had then.
      if (!next.receipt && this.entryOwner(next) === this.ownerKey()) void this.obtainReceipt(next.id);
    }
    // A download that stopped by itself is started again without anybody having to notice.
    if (next.state !== before?.state && (next.state === 'failed' || next.state === 'paused')) void this.tend(this.generation);
  }
  private async measure() {
    if (!native) return;
    try {
      const s = await native.storage();
      const totalBytes = typeof s.totalBytes === 'number' && Number.isSafeInteger(s.totalBytes) && s.totalBytes > 0 ? s.totalBytes : undefined;
      const bytes = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
      this.publish({freeBytes: s.freeBytes, usedBytes: s.usedBytes, totalBytes, storedBytes:bytes(s.storedBytes), allocatedBytes:bytes(s.allocatedBytes)});
    } catch {}
  }
  /** Unsent plays for the connected viewer. Another viewer's queue is not
   * this viewer's business and is not counted into their badge. */
  private pendingCount() {
    const owner = this.ownerKey();
    return owner ? Object.keys(this.stored.plays[owner] ?? {}).length + Object.values(this.stored.reading[owner] ?? {}).filter(value => !!value?.pending).length : 0;
  }
  /** Writes the bookkeeping document. A failed write is reported rather than published as
   * saved: the Downloads screen shows it until a later write succeeds. */
  private async persist(): Promise<boolean> {
    const saved = native ? await native.writeState(JSON.stringify(this.stored)).then(() => true, () => false) : true;
    const unwritable = serviceText('downloads.deviceUnwritable');
    const error = saved ? (this.state.error === unwritable ? undefined : this.state.error) : unwritable;
    this.publish({settings: this.stored.settings, pendingProgress: this.pendingCount(), error});
    return saved;
  }
  /** Changes what is kept with one entry, leaving the rest of it as it was. */
  private async patch(id: string, change: Partial<Meta>): Promise<void> {
    if (!native || !this.all.some(e => e.id === id)) return;
    const next = {...(this.metas.get(id) ?? {}), ...change};
    this.metas.set(id, next);
    await native.setMeta(id, JSON.stringify(next));
  }

  /** Remembers that a title asked for from this device is wanted on this device, so that when the
   * server has prepared it the file comes here by itself. */
  async want(itemIds: readonly string[], display?: OfflineDisplay, originatingService?: DownloadsService) {
    if (originatingService && originatingService !== this.service) return;
    const owner = this.ownerKey(), generation = this.generation;
    if (!this.state.supported || !owner) return;
    const mine = bucket(this.stored.wanted, owner);
    for (const id of itemIds) mine[id] = itemIds.length === 1 && display ? display : {title: ''};
    await this.persist();
    if (this.generation === generation) void this.collect(generation);
  }
  async wantPublication(preparation: DownloadPreparation, originatingService: DownloadsService) {
    const owner = this.ownerKey(), generation = this.generation;
    if (!owner || !this.state.supported || originatingService !== this.service || !preparation.versionId || (preparation.title.kind !== 'ebook' && preparation.title.kind !== 'comic')) throw new Error('reading_unavailable');
    bucket(this.stored.wantedPublications, owner)[preparation.id] = this.display(preparation);
    if (!await this.persist()) throw new Error('reading_progress_not_saved');
    if (generation === this.generation) void this.collect(generation);
  }
  /** How a claim on the server is named: the claim carries its own title. */
  display(preparation: DownloadPreparation): OfflineDisplay {
    const lines = downloadTitleLines(preparation.title);
    return {title: lines.title, subtitle: lines.subtitle, libraryId: preparation.libraryId, kind: preparation.title.kind};
  }
  /** Fetches whatever the connected viewer asked for from this device and is now ready. One
   * that cannot be fetched (no space, over the limit) stays on the list with the reason and a
   * button. Another viewer's outstanding wants are left untouched until they connect. */
  private async collect(generation = this.generation) {
    const owner = this.ownerKey(), service = this.service;
    if (generation !== this.generation || !service || !this.state.ready || !owner) return;
    await this.enrollRequests(owner, service, generation).catch(() => {});
    if (generation !== this.generation) return;
    const mine = this.stored.wanted[owner] ?? {}, publications = this.stored.wantedPublications[owner] ?? {};
    if (!Object.keys(mine).length && !Object.keys(publications).length) return;
    let collected = false;
    for (const p of service.getSnapshot().items) {
      if (this.generation !== generation) return;
      if ((!mine[p.itemId] && !publications[p.id]) || p.state !== 'ready' || this.collecting.has(p.id) || this.all.some(e => e.id === p.id) || this.blocked(p)) continue;
      this.collecting.add(p.id);
      try {
        await this.fetch(p);
        if (this.generation !== generation) return;
        delete this.stored.wanted[owner]?.[p.itemId];
        delete this.stored.wantedPublications[owner]?.[p.id];
        await this.persist();
        collected = true;
      } catch { /* offered by hand on the Downloads page */ } finally { this.collecting.delete(p.id); }
    }
    // Room on the list: a large request that was waiting for it reads on.
    if (collected && [...this.enrolled.values()].some(reading => !reading.tail)) this.enrollSoon(generation);
  }
  /** One more pass, shortly: a fresh one, so no single pass does unbounded work. */
  private enrollSoon(generation: number) {
    if (generation !== this.generation || this.enrollTimer) return;
    this.enrollTimer = setTimeout(() => { this.enrollTimer = undefined; void this.collect(generation); }, 0);
  }
  /** A whole season, show, album or book asked for from this device comes to this device like a
   * single title does: each member is wanted as the request lists it, however many there are.
   * The requests themselves are the server's to remember (the service finds this device's again
   * after the app was closed), so the rest of a show still arrives after a restart.
   * Members past the first page (100) are read a bounded batch of pages at a time. Each batch
   * carries on after the last member read, and what it enrolled is saved before the next one
   * starts, so a very large request is neither cut short nor read from the start again. Reading
   * waits while the list of members still to be collected is full, and goes on as they arrive, so
   * that list stays bounded however large the request is. Once the last page is reached it is
   * looked at again only when the request's counts change, which is how members the server lists
   * later are found. */
  private async enrollRequests(owner: string, service: DownloadsService, generation: number) {
    if (generation !== this.generation) return;
    const mine = bucket(this.stored.wanted, owner), api = this.api;
    let added = false, more = false;
    for (const tracked of service.getSnapshot().requests) {
      const r = tracked.request;
      const add = (items: readonly {itemId: string}[]) => {
        for (const it of items) {
          const key = `${owner}|${r.requestId}|${it.itemId}`;
          if (this.enrolledItems.has(key)) continue;
          if (!mine[it.itemId] && !this.all.some(e => e.itemId === it.itemId && this.entryOwner(e) === owner)) {
            if (Object.keys(mine).length >= ENROLL_BACKLOG) return false;
            mine[it.itemId] = {title: ''}; added = true;
          }
          this.enrolledItems.add(key);
        }
        return true;
      };
      if (!add(r.items)) break;
      if (!r.nextCursor || !api) continue;
      const mark = `${r.total}/${r.ready}/${r.preparing}/${r.queued}`;
      const requestKey = JSON.stringify([owner, r.requestId]);
      const reading = this.enrolled.get(requestKey) ?? {after: r.nextCursor, read: 0, mark: '', tail: false, busy: false, retryAt: 0};
      this.enrolled.set(requestKey, reading);
      // Another pass is reading this request, or it has been read to its end (or to a page that
      // could not be read) and nothing about it has changed since.
      if (reading.busy || (reading.tail && reading.mark === mark) || (reading.mark === mark && Date.now() < reading.retryAt)) continue;
      const restart = () => { reading.after = r.nextCursor; reading.read = 0; reading.tail = true; };
      reading.mark = mark; reading.tail = false; reading.busy = true; reading.retryAt = 0;
      let held = false;
      try {
        for (let i = 0; i < ENROLL_PAGES_PER_PASS && !reading.tail; i++) {
          if (Object.keys(mine).length >= ENROLL_BACKLOG) { held = true; break; }
          const page = await getDownloadRequest(api, r.requestId, {cursor: reading.after});
          if (generation !== this.generation) return;
          if (!add(page.items)) { held = true; break; }
          reading.read += page.items.length;
          // More members than the request has: its list changed under the reading (or the server
          // is repeating itself). Stop, and read from the first page when it next changes.
          if (r.items.length + reading.read > page.total) restart();
          else if (!page.nextCursor || page.nextCursor === reading.after || !page.items.length) { reading.read -= page.items.length; reading.tail = true; }
          else reading.after = page.nextCursor;
        }
        if (!reading.tail && !held) more = true;
      } catch (e) {
        // A transient refusal is not the end of the list. Retry from here after a short floor,
        // even when counts are unchanged; an expired cursor starts from the first page.
        if ((e as {status?: unknown} | null)?.status === 400) { reading.after = r.nextCursor; reading.read = 0; }
        reading.retryAt = Date.now() + RETRY_EVERY_MS;
      } finally { reading.busy = false; }
    }
    if (added) await this.persist();
    // The rest of a large request is the next batch's.
    if (more) this.enrollSoon(generation);
  }
  /** Finishing a title asks the server to prepare the next one, and the accepted items become
   * this viewer's local wants — the same two steps the download sheet performs. */
  private async autoNext(entry: OfflineEntry) {
    const owner = this.entryOwner(entry);
    if (!owner) return;
    bucket(this.stored.nextAfter, owner)[entry.itemId] = {quality: entry.quality, libraryId: entry.libraryId, kind: entry.kind};
    await this.persist();
    if (owner === this.ownerKey()) await this.continueNext();
  }
  private async continueNext(generation = this.generation) {
    const service = this.service, owner = this.ownerKey();
    if (!service || !owner || generation !== this.generation || !this.stored.settings.autoNext) return;
    for (const [itemId, intent] of Object.entries(this.stored.nextAfter[owner] ?? {})) {
      if (generation !== this.generation) return;
      const key = JSON.stringify([generation, owner, itemId]);
      if (this.continuing.has(key)) continue;
      this.continuing.add(key);
      try {
        const batch = await service.request({nextAfterMediaId: itemId}, intent.quality);
        if (generation !== this.generation) return;
        if (batch.items.length) await this.want(batch.items.map(p => p.itemId));
        if (generation !== this.generation) return;
        if (this.stored.nextAfter[owner]?.[itemId] === intent) delete this.stored.nextAfter[owner]![itemId];
        await this.persist();
      } catch (e) {
        // No next episode is an answer, not something to keep asking about.
        if ((e as {status?: unknown} | null)?.status === 404 && this.stored.nextAfter[owner]?.[itemId] === intent) { delete this.stored.nextAfter[owner]![itemId]; await this.persist(); }
      }
      finally { this.continuing.delete(key); }
    }
  }

  /** Bytes promised to transfers that haven't finished: counted against the limit (whole files)
   * and against free space (what is still to arrive), so starting several at once can't overshoot. */
  private starting = new Map<string, number>();
  private inFlight() {
    let whole = 0, remaining = 0;
    for (const e of this.all) if (e.state !== 'ready') { whole += e.bytes; remaining += Math.max(0, e.bytes - e.bytesDone); }
    for (const [id, bytes] of this.starting) if (!this.all.some(e => e.id === id)) { whole += bytes; remaining += bytes; }
    return {whole, remaining};
  }
  /** Why a server-prepared file cannot be fetched right now, or '' when it can. */
  blocked(preparation: DownloadPreparation): string {
    if (preparation.state !== 'ready') return serviceText('downloads.blocked.preparing');
    const size = preparation.artifact.bytes, limit = this.state.settings.limitBytes, pending = this.inFlight();
    if (limit > 0 && this.state.usedBytes + pending.whole + size > limit) return serviceText('downloads.blocked.limit');
    if (this.state.freeBytes > 0 && size + pending.remaining + 500 * 1048576 > this.state.freeBytes) return serviceText('downloads.blocked.space');
    return '';
  }
  async fetch(preparation: DownloadPreparation): Promise<void> {
    const owner = this.ownerKey(), api = this.api, service = this.service, generation = this.generation;
    if (!native || !service || !api || !owner) throw new Error(serviceText('downloads.connectToStart'));
    const reason = this.blocked(preparation); if (reason) throw new Error(reason);
    this.starting.set(preparation.id, preparation.artifact.bytes);
    try { await this.transfer({id: preparation.id, itemId: preparation.itemId, quality: preparation.quality, libraryId: preparation.libraryId, title: preparation.title}, owner, api, service, generation); }
    finally { this.starting.delete(preparation.id); }
  }
  /** Starts, or continues, moving one download's bytes.
   *
   * The receipt is taken first: the server knows the file's digest before a byte moves, so a
   * download that finishes with the app closed and no connection is already allowed to play.
   * The address is the one this download already had whenever the server will keep it alive,
   * and the bytes already here are continued either way: they belong to the file, not to the
   * address. */
  private async transfer(target: {id: string; itemId: string; quality: string; libraryId?: string; title?: DownloadTitle}, owner: string, api: Api, service: DownloadsService, generation: number) {
    if (!native) throw new Error(serviceText('downloads.unavailableOnDevice'));
    const held = this.metas.get(target.id) ?? {};
    const claim = held.claim ?? target.id;
    // A receipt that has run out, or soon will, is no better than none for a download that may
    // finish with no connection.
    let receipt = held.receipt;
    if (!receipt || Date.parse(receipt.claims.expiresAt) - this.receiptNow() < 7 * 24 * 60 * 60 * 1000) receipt = await this.issueReceipt(api, claim).catch(() => undefined) ?? receipt;
    const grant = await service.grant({id: claim}, held.token);
    if (this.generation !== generation) throw new Error(serviceText('downloads.connectToStart'));
    const title = target.title ?? held.title;
    // The owner is recorded before the first byte arrives, so a transfer that is still running
    // when the viewer changes is not left unattributed.
    const meta: Meta = {...held, libraryId: target.libraryId ?? held.libraryId, kind: title?.kind ?? held.kind, owner, receipt, title, token: grant.token, onServer: true, ...(claim !== target.id ? {claim} : {})};
    await this.startTransfer(target, meta, grant, api);
    void this.bundle(target.id, api, service, generation, grant.url);
  }
  private async startTransfer(target: {id: string; itemId: string; quality: string}, meta: Meta, grant: Awaited<ReturnType<DownloadsService['grant']>>, api: Api) {
    if (!native) return;
    const lines = meta.title ? downloadTitleLines(meta.title) : {title: '', subtitle: ''};
    this.metas.set(target.id, meta);
    await native.start({
      id: target.id, url: api.mediaUrl(grant.url), fileName: grant.artifact.fileName, bytes: grant.artifact.bytes, sha256: grant.artifact.sha256,
      contentType: grant.artifact.contentType, itemId: target.itemId, title: lines.title, subtitle: lines.subtitle, quality: target.quality, meta: JSON.stringify(meta),
    });
  }
  /** Fetches what travels with a download — its description, artwork, chapters, markers and
   * subtitles — and keeps it beside the file. What the server has none of is simply absent;
   * what could not be had yet is fetched on a later pass. */
  private async bundle(id: string, api: Api, service: DownloadsService, generation: number, address?: string) {
    const before = this.metas.get(id), reading = before?.kind === 'ebook' || before?.kind === 'comic';
    if (!native || this.bundling.has(id) || (before?.bundle ?? 0) >= BUNDLE_COMPLETE && (!reading || before?.publication === true)) return;
    this.bundling.add(id);
    try {
      const claim = this.metas.get(id)?.claim ?? id;
      const raw = await api.request<unknown>(`/v1/downloads/preparations/${encodeURIComponent(claim)}/bundle`);
      const described = parseDownloadBundle(raw, claim);
      const publication = object(raw) && typeof raw.publication === 'string' ? raw.publication : undefined;
      const base = address ?? (await service.grant({id: claim}, this.metas.get(id)?.token)).url;
      if (this.generation !== generation || !this.all.some(e => e.id === id)) return;
      await native.writeExtra(id, 'bundle.json', JSON.stringify(described));
      if (reading) {if (publication === undefined || publication.length > 2 << 20) throw new Error('reading_unavailable'); await native.writeExtra(id, 'publication.json', publication);
        if (generation !== this.generation) return; await this.patch(id, {publication: true});}
      const saved = new Set(this.metas.get(id)?.extras ?? []);
      let complete = true;
      const files: [string, string][] = [
        ...described.artwork.map(a => [a.role, a.path] as [string, string]),
        // Each track's files under one stem: the script with its fonts, a VobSub index with its pictures.
        ...described.subtitles.flatMap(s => subtitleExtraFiles(s).map(([name, path]) => [name, path] as [string, string])),
        // The scrubbing previews and the chapter thumbnails, so the offline player shows them too.
        ...(described.trickplay?.tiles ?? []).map((tile, index) => [trickplayTileName(index), tile.path] as [string, string]),
        ...described.chapters.flatMap(c => (c.image ? [[chapterImageName(c.index), c.image.path] as [string, string]] : [])),
      ];
      for (const [name, path] of files) {
        if (saved.has(name)) continue;
        const outcome = await native.fetchExtra(id, name, api.mediaUrl(base + '/' + path)).catch(() => 'later');
        if (this.generation !== generation) return;
        if (outcome === 'saved') saved.add(name); else if (outcome !== 'missing') complete = false;
      }
      await this.patch(id, {title: described.title, kind: described.title.kind, extras: [...saved], bundle: complete ? BUNDLE_COMPLETE : 1});
    } catch { /* completed on a later pass */ } finally { this.bundling.delete(id); }
  }
  /** Looks after downloads that need something only a reachable server can give: one that stopped
   * by itself is started again, one still moving has its address kept alive, one that arrived
   * without its extras gets them. Nothing here touches a download the person paused. */
  private async tend(generation: number) {
    const owner = this.ownerKey(), api = this.api, service = this.service;
    if (generation !== this.generation || !owner || !api || !service || !this.state.ready) return;
    void this.collect(generation);
    void this.syncProgress(generation);
    void this.syncReadingProgress(generation);
    void this.continueNext(generation);
    void this.renewReceipts(generation, api, owner, false);
    const now = Date.now();
    for (const entry of this.ownedEntries(owner)) {
      if (this.generation !== generation) return;
      const meta = this.metas.get(entry.id) ?? {};
      const stopped = !entry.held && ((entry.state === 'failed' && RETRYABLE.has(entry.error)) || entry.state === 'paused');
      if (stopped) {
        if (now - (this.retried.get(entry.id) ?? 0) < RETRY_EVERY_MS) continue;
        this.retried.set(entry.id, now);
        await this.transfer({id: entry.id, itemId: entry.itemId, quality: entry.quality}, owner, api, service, generation).catch(e => {
          // The server no longer has this to hand over (its claim ended while the transfer was
          // stopped). Asking every half minute would change nothing: it is left for a quarter of
          // an hour, and Try again says why straight away.
          const status = (e as {status?: unknown} | null)?.status;
          if (status === 404 || status === 409 || status === 410) this.retried.set(entry.id, now + 15 * 60 * 1000);
        });
      } else if (entry.state === 'downloading' && meta.token) {
        // Keeping the address alive is what lets the phone's own downloader pick the transfer up
        // again, hours from now, with the app closed.
        if (now - (this.retried.get('renew:' + entry.id) ?? 0) < 60 * 60 * 1000) continue;
        this.retried.set('renew:' + entry.id, now);
        await service.grant({id: meta.claim ?? entry.id}, meta.token).then(async grant => {
          if (generation !== this.generation || owner !== this.ownerKey() || grant.token === meta.token) return;
          const current = this.all.find(e => e.id === entry.id);
          const latest = this.metas.get(entry.id);
          if (!current || current.held || current.state !== 'downloading' || this.entryOwner(current) !== owner || latest?.token !== meta.token) return;
          const artifact = current.receipt?.claims.artifact;
          if (artifact && (artifact.sha256 !== grant.artifact.sha256 || artifact.bytes !== grant.artifact.bytes)) return;
          await this.startTransfer(current, {...latest, token: grant.token}, grant, api);
        }).catch(() => {});
      } else if (entry.state === 'ready' && ((meta.bundle ?? 0) < BUNDLE_COMPLETE || (entry.kind === 'ebook' || entry.kind === 'comic') && meta.publication !== true) && entry.onServer) {
        if (now - (this.retried.get('bundle:' + entry.id) ?? 0) < 10 * 60 * 1000) continue;
        this.retried.set('bundle:' + entry.id, now);
        await this.bundle(entry.id, api, service, generation);
      }
    }
  }
  /** Continues a paused or stopped transfer from the bytes already on the device. */
  async resume(entry: OfflineEntry) {
    const owner = this.ownerKey(), api = this.api, service = this.service;
    if (!owner || !api || !service || this.entryOwner(entry) !== owner) throw new Error(serviceText('downloads.connectToContinue'));
    this.retried.delete(entry.id);
    await this.transfer({id: entry.id, itemId: entry.itemId, quality: entry.quality}, owner, api, service, this.generation);
  }
  /** The person paused it: it stays paused until they continue it. */
  pause(entry: OfflineEntry) { return native?.pause(entry.id) ?? Promise.resolve(); }
  /** Removes a download from this device. The server is told this device no longer holds the
   * copy (unless it was the server that withdrew it); its own claim on the title is left for the
   * viewer's other devices. */
  async remove(entry: OfflineEntry, withdrawn = false) {
    const receipt = entry.receipt, owner = this.entryOwner(entry);
    await native?.remove(entry.id);
    this.retried.delete(entry.id);
    if (owner) {delete this.stored.resume[owner]?.[entry.itemId]; delete this.stored.reading[owner]?.[entry.id]; delete this.stored.wantedPublications[owner]?.[entry.id];}
    await this.persist();
    if (!withdrawn && receipt && this.api && owner === this.ownerKey()) void this.api.request<unknown>('/v1/downloads/receipts/revoke', 'POST', {operationId: operationId(), receiptIds: [receipt.receiptId], reason: 'removed'}).catch(() => {});
  }
  /** Removes every download on this device that is not the connected viewer's. They are never
   * shown; this is how the space they take is given back. */
  async removeOthers() {
    const owner = this.ownerKey();
    if (!owner || !native) return;
    const generation = this.generation;
    for (const entry of this.all.filter(e => this.entryOwner(e) !== owner)) {
      if (generation !== this.generation || this.ownerKey() !== owner) return;
      await native.remove(entry.id); if (generation !== this.generation || this.ownerKey() !== owner) return;
      const erasedOwner = this.entryOwner(entry); if (erasedOwner) {delete this.stored.reading[erasedOwner]?.[entry.id]; delete this.stored.wantedPublications[erasedOwner]?.[entry.id];}
    }
    await this.persist();
    void this.measure();
  }

  private async issueReceipt(api: Api, claim: string): Promise<DownloadReceipt | undefined> {
    const outcomes = parseReceiptOutcomes(await api.request<unknown>('/v1/downloads/receipts', 'POST', {operationId: operationId(), preparationIds: [claim]}));
    const receipt = outcomes.find(o => o.preparationId === claim && o.receipt)?.receipt ?? undefined;
    if (receipt) this.trustServerTime([receipt.claims.issuedAt]);
    return receipt;
  }
  /** The time a receipt's expiry is judged by (B-14.21, receipt-clock.ts): never earlier than the
   * latest time this device has trusted. The floor is written when it moves by more than a minute. */
  private receiptNow(): number {
    const {nowMs, floorMs} = receiptTime({floorMs: this.stored.clockFloor}, Date.now());
    if (floorMs - this.stored.clockFloor > 60_000) { this.stored.clockFloor = floorMs; void this.persist(); }
    return nowMs;
  }
  /** The server answered with receipts: its time is the trusted one. */
  private trustServerTime(issuedAt: readonly string[]) {
    const floor = serverReceiptFloor({floorMs: this.stored.clockFloor}, issuedAt);
    if (floor !== this.stored.clockFloor) { this.stored.clockFloor = floor; void this.persist(); }
  }
  private async obtainReceipt(id: string, generation = this.generation) {
    if (generation !== this.generation || !native || !this.api || this.receiving.has(id)) return;
    const api = this.api;
    this.receiving.add(id);
    try {
      const receipt = await this.issueReceipt(api, this.metas.get(id)?.claim ?? id);
      if (this.generation !== generation || !receipt) return;
      await this.patch(id, {receipt, owner: offlineOwnerKey(receipt.claims.viewer)});
      await this.verifyAll();
    } catch { /* tried again the next time the app is online */ } finally { this.receiving.delete(id); }
  }
  /** Extends this viewer's receipts while online, and drops what the server has
   * withdrawn from them. Another viewer's downloads are not submitted at all: the
   * server cannot recognise a receipt issued to someone else, and treating that
   * answer as permission to delete is how one profile erased another's files.
   *
   * It runs once a day, not on every connection: a renewal rewrites each receipt on the
   * server and on this device. `force` is for the moment the server says downloads are off
   * for this profile, which is exactly when each copy must be asked about. */
  private renewReceipts(generation = this.generation, apiArg = this.api, ownerArg = this.ownerKey(), force = false): Promise<void> {
    if (!apiArg || !ownerArg || generation !== this.generation) return Promise.resolve();
    const flight = this.receiptSync;
    if (flight?.generation === generation && flight.owner === ownerArg) {
      if (force && !flight.forced) return flight.task.then(() => this.renewReceipts(generation, apiArg, ownerArg, true));
      return flight.task;
    }
    const task = this.revalidateReceipts(generation, apiArg, ownerArg, force).catch(() => {});
    this.receiptSync = {generation, owner: ownerArg, forced: force, task};
    void task.finally(() => { if (this.receiptSync?.task === task) this.receiptSync = undefined; }).catch(() => {});
    return task;
  }
  private async revalidateReceipts(generation: number, apiArg: Api, ownerArg: string, force: boolean) {
    const api = apiArg, owner = ownerArg;
    if (generation !== this.generation || !api || !owner) return;
    const mine = this.ownedEntries(owner);
    // A finished download with no receipt yet (it could not be had when the transfer began).
    for (const e of mine) if (e.state === 'ready' && !e.receipt) void this.obtainReceipt(e.id, generation);
    const held = mine.filter(e => e.receipt);
    const now = this.receiptNow(), soon = held.some(e => Date.parse(e.receipt!.claims.expiresAt) - now < 7 * 24 * 60 * 60 * 1000);
    if (!force && !soon && Date.now() - (this.stored.renewed[owner] ?? 0) < RENEW_EVERY_MS) return;
    // The server renews at most 100 receipts per request, so a large library of downloads is
    // renewed in batches, and each batch is written to the device once.
    for (let i = 0; i < held.length; i += RECEIPT_BATCH) {
      const batch = held.slice(i, i + RECEIPT_BATCH);
      let outcomes: readonly ReceiptOutcome[];
      try { outcomes = parseReceiptOutcomes(await api.request<unknown>('/v1/downloads/receipts/revalidate', 'POST', {operationId: operationId(), receiptIds: batch.map(e => e.receipt!.receiptId)})); }
      catch { return; /* offline or busy: receipts stay valid until they expire */ }
      if (this.generation !== generation) return;
      const changes: Record<string, string> = {};
      const unknown: OfflineEntry[] = [];
      for (const o of outcomes) {
        const entry = batch.find(e => e.receipt!.receiptId === o.receiptId); if (!entry) continue;
        if (o.outcome === 'renewed' && o.receipt) {
          this.trustServerTime([o.receipt.claims.issuedAt]);
          const next: Meta = {...(this.metas.get(entry.id) ?? {}), receipt: o.receipt, owner: offlineOwnerKey(o.receipt.claims.viewer), ...(o.titleOnServer === null ? {} : {onServer: o.titleOnServer})};
          this.metas.set(entry.id, next);
          changes[entry.id] = JSON.stringify(next);
          // Where another device left the title is where this copy resumes, unless this device
          // has a play of its own still to send (the server has not weighed that one yet).
          if (o.viewing && !Object.values(this.stored.plays[owner] ?? {}).some(p => p.itemId === entry.itemId)) bucket(this.stored.resume, owner)[entry.itemId] = o.viewing.watched ? 0 : o.viewing.positionSeconds;
        } else if (o.outcome === 'refused' && revokesOwnedFile(o.code)) await this.remove(entry, true);
        else if (o.outcome === 'refused') unknown.push(entry);
      }
      if (this.generation !== generation) return;
      if (native && Object.keys(changes).length) await native.setMetas(changes).catch(() => {});
      for (const entry of unknown) void this.recover(entry, generation);
    }
    if (this.generation !== generation) return;
    this.stored.renewed[owner] = Date.now();
    await this.persist();
    if (this.generation === generation) await this.verifyAll();
  }
  /** The server has no record of a receipt this device holds (it was restored from an older
   * backup, or its records of the claim are gone). The copy is kept. A new receipt is asked for:
   * for the claim it was made under, and when that is unknown too, for the same title at the same
   * quality again. A fresh claim that names the very file this device holds (the same digest) is
   * adopted and nothing is transferred; one that names a different file leaves this copy as it is,
   * playable until its receipt runs out, and says the server's file has changed. */
  private async recover(entry: OfflineEntry, generation: number) {
    const api = this.api, service = this.service;
    if (!api || !service || generation !== this.generation || this.receiving.has(entry.id)) return;
    this.receiving.add(entry.id);
    try {
      const meta = this.metas.get(entry.id) ?? {};
      const mine = entry.receipt?.claims.artifact;
      let claim = meta.claim ?? entry.id;
      let receipt = await this.issueReceipt(api, claim);
      if (!receipt) {
        const publication = entry.kind === 'ebook' || entry.kind === 'comic' ? this.publicationBinding(entry.receipt) : undefined;
        const batch = await service.request({mediaId: entry.itemId, ...(publication ? {versionId: publication.sourceId} : {})}, entry.quality);
        const fresh = batch.items.find(p => p.itemId === entry.itemId);
        if (!fresh || this.generation !== generation) return;
        if (fresh.state !== 'ready') return; // looked at again at the next renewal
        if (mine && (fresh.artifact.sha256 !== mine.sha256 || fresh.artifact.bytes !== mine.bytes)) { await this.patch(entry.id, {changed: true}); return; }
        claim = fresh.id;
        receipt = await this.issueReceipt(api, claim);
      }
      if (!receipt || this.generation !== generation) return;
      if (mine && (receipt.claims.artifact.sha256 !== mine.sha256 || receipt.claims.artifact.bytes !== mine.bytes)) { await this.patch(entry.id, {changed: true}); return; }
      const publication = entry.kind === 'ebook' || entry.kind === 'comic';
      await this.patch(entry.id, {receipt, owner: offlineOwnerKey(receipt.claims.viewer), claim: claim === entry.id ? undefined : claim, changed: false, ...(publication ? {publication: false} : {})});
      if (publication && generation === this.generation) await this.bundle(entry.id, api, service, generation);
      await this.verifyAll();
    } catch { /* tried again at the next renewal */ } finally { this.receiving.delete(entry.id); }
  }

  /** The server's receipt-signing keys, remembered so a receipt can be checked with no
   * connection. A receipt whose signature does not verify is treated as no receipt. */
  private async refreshKeys(generation: number, api: Api) {
    if (generation !== this.generation) return;
    try {
      const keys = parseReceiptKeys(await api.request<unknown>('/v1/downloads/receipt-keys'));
      if (generation !== this.generation) return;
      let added = false;
      for (const key of keys) if (this.stored.keys[key.id] !== key.publicKey) { this.stored.keys[key.id] = key.publicKey; added = true; }
      if (added) await this.persist();
      if (generation !== this.generation) return;
      await this.verifyAll();
    } catch (e) {
      // Downloads have been turned off for this profile: every copy is asked about now, and the
      // server refuses each of them by name.
      const code = (e as {code?: unknown} | null)?.code;
      if (code === 'feature_restricted' || code === 'downloads_not_allowed') void this.renewReceipts(generation, api, this.ownerKey(), true);
    }
  }
  private async verifyAll() {
    for (const entry of this.all) {
      const receipt = entry.receipt; if (!receipt || this.verified.has(signedIdentity(receipt))) continue;
      const publicKey = this.stored.keys[receipt.keyId]; if (!publicKey) continue;
      try {
        const {signedBytes, signatureBytes} = decodeDownloadReceipt(receipt);
        if (await nativeRouteCrypto.verify(base64url(publicKey), signatureBytes, signedBytes)) this.verified.add(signedIdentity(receipt));
      } catch { /* not verified */ }
    }
    this.publishEntries();
  }

  /** Whether this download may be played now, and if not, why. Usable with no connection. */
  playabilityReason(entry: OfflineEntry, viewer: Viewer | undefined = this.viewer): OfflinePlayabilityReason|null {
    if (!viewer) return 'sign_in';
    if (entry.state !== 'ready') return 'not_finished';
    if (!entry.receipt || !this.verified.has(signedIdentity(entry.receipt))) return 'needs_setup';
    const now = this.receiptNow();
    if (!receiptUsable(entry.receipt.claims, viewer, new Date(now))) return Date.parse(entry.receipt.claims.expiresAt) <= now ? 'needs_check_in' : 'other_profile';
    return null;
  }
  playable(entry: OfflineEntry, viewer: Viewer | undefined = this.viewer): string {
    const reason = this.playabilityReason(entry,viewer);
    const messages = {sign_in:'downloads.offline.signIn',not_finished:'downloads.offline.notFinished',needs_setup:'downloads.offline.needsSetup',needs_check_in:'downloads.offline.needsCheckIn',other_profile:'downloads.offline.otherProfile'} as const;
    return reason ? serviceText(messages[reason]) : '';
  }
  /** A line to show under a download that plays but has something worth saying about it. */
  note(entry: OfflineEntry): string {
    if (!entry.onServer) return serviceText('downloads.offline.goneFromServer');
    if (entry.changedOnServer) return serviceText('downloads.offline.changedOnServer');
    return '';
  }
  private resumePoint(entry: OfflineEntry): number {
    const owner = this.entryOwner(entry);
    return Math.max(0, (owner ? this.stored.resume[owner]?.[entry.itemId] : 0) ?? 0);
  }
  /** A local file read cannot escape the viewer/generation/artifact that admitted it. */
  private localRead(entry: OfflineEntry): () => OfflineEntry {
    const generation=this.generation, owner=this.ownerKey();
    const identity=(value:OfflineEntry)=>JSON.stringify([value.id,value.itemId,this.entryOwner(value),value.receipt?.claims.preparationId,value.receipt?.claims.artifact.sha256,value.receipt?.claims.artifact.bytes]);
    const expected=identity(entry);
    const current=()=>{
      const live=this.all.find(value=>value.id===entry.id);
      if(!owner||generation!==this.generation||owner!==this.ownerKey()||!live||this.entryOwner(live)!==owner||identity(live)!==expected)throw new Error(serviceText('downloads.offline.otherProfile'));
      return live;
    };
    current();return current;
  }
  async displayFacts(entry: OfflineEntry): Promise<OfflineEntryFacts> {
    const current=this.localRead(entry);
    let bundle:unknown;
    try { const raw=await native?.readExtra(entry.id,'bundle.json');bundle=raw?JSON.parse(raw):undefined; } catch { /* Unknown cached fields stay absent. */ }
    const live=current(),owner=this.ownerKey()!,result:{resumePositionSeconds?:number;backdropUrl?:string;media?:OfflineEntryFacts['media']}={};
    const position=this.stored.resume[owner]?.[live.itemId];
    if(typeof position==='number'&&Number.isFinite(position)&&position>=0)result.resumePositionSeconds=position;
    const dir=this.dirs.get(live.id),meta=this.metas.get(live.id);
    if(dir&&meta?.extras?.includes('backdrop'))result.backdropUrl=dir+'extras/backdrop';
    const value=bundle!==null&&typeof bundle==='object'?bundle as Record<string,unknown>:undefined;
    const claim=meta?.claim??live.receipt?.claims.preparationId??live.id;
    const raw=value?.itemId===live.itemId&&(value?.preparationId===claim||value?.preparationId===live.id)?value.media:undefined;
    if(raw!==null&&typeof raw==='object') {
      const source=raw as Record<string,unknown>,media:{container?:string;videoCodec?:string;audioCodec?:string;width?:number;height?:number}={};
      for(const key of ['container','videoCodec','audioCodec'] as const)if(typeof source[key]==='string'&&source[key].length>0&&source[key].length<=128&&!/[\u0000-\u001f\u007f]/.test(source[key]))media[key]=source[key];
      for(const key of ['width','height'] as const)if(typeof source[key]==='number'&&Number.isSafeInteger(source[key])&&source[key]>0)media[key]=source[key];
      if(Object.keys(media).length)result.media=Object.freeze(media);
    }
    return Object.freeze(result);
  }
  /** The downloaded file, this viewer's resume point and everything that came with the download,
   * for Portico's own player (the only offline player). No connection needed. */
  private publicationBinding(receipt: DownloadReceipt | undefined): PublicationBinding {
    if (!receipt) throw new Error('reading_unavailable'); return signedPublication(receipt);
  }
  publicationSource(entry: OfflineEntry): Readonly<{sourceId: string; revision: string}> {
    const current = this.localRead(entry), live = current();
    if (!nativePublicationReadsAvailable() || this.playabilityReason(live)) throw new Error('reading_unavailable');
    return this.publicationBinding(live.receipt);
  }
  /** Display facts for a downloaded publication under the same viewer, receipt and
   * lifetime guards as opening it. The signed descriptor may contribute its real page
   * total; a missing total stays absent, and no format is guessed from a title. */
  async readingFacts(entry: OfflineEntry): Promise<OfflineReadingFacts> {
    const read = this.localRead(entry), owner = this.ownerKey(), live = read();
    if (!native || !owner || !nativePublicationReadsAvailable() || this.playabilityReason(live)) throw new Error('reading_unavailable');
    const binding = this.publicationBinding(live.receipt), receipt = live.receipt!;
    let pageCount: number | undefined;
    try {
      const raw = await native.readExtra(entry.id, 'publication.json'), bytes = publicationUTF8(raw);
      const digest = Array.from(await nativeRouteCrypto.sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest === binding.documentSha256) {
        const doc: unknown = JSON.parse(raw);
        if (object(doc) && doc.format === binding.format) {
          if (binding.format === 'cbz' && Array.isArray(doc.pageNames) && safeInteger(doc.pageNames.length, 1) && doc.pageNames.length <= 4096) pageCount = doc.pageNames.length;
          else if (binding.format === 'pdf' && object(doc.metadata)) {
            const count = doc.metadata.pageCount;
            if (safeInteger(count, 1) && count <= 4096) pageCount = count;
          }
        }
      }
    } catch { /* An older or absent descriptor keeps the real format and position; the total stays omitted. */ }
    // The owner/generation/artifact guard covers a replaced entry; the receipt must also
    // still be this viewer's usable lifetime for the exact original publication. Only
    // then may the private record after the awaits supply a place.
    const final = read();
    if (this.playabilityReason(final)) throw new Error('reading_unavailable');
    const finalReceipt = final.receipt!, finalBinding = this.publicationBinding(finalReceipt);
    if (finalReceipt.claims.preparationId !== receipt.claims.preparationId
      || finalReceipt.claims.artifact.sha256 !== receipt.claims.artifact.sha256 || finalReceipt.claims.artifact.bytes !== receipt.claims.artifact.bytes
      || finalBinding.sourceId !== binding.sourceId || finalBinding.revision !== binding.revision || finalBinding.documentSha256 !== binding.documentSha256 || finalBinding.format !== binding.format) throw new Error('reading_unavailable');
    const record = this.stored.reading[owner]?.[entry.id];
    const matches = !!record && record.itemId === final.itemId && record.sourceId === finalBinding.sourceId && record.revision === finalBinding.revision
      && record.documentSha256 === finalBinding.documentSha256 && record.artifactSha256 === finalReceipt.claims.artifact.sha256 && record.artifactBytes === finalReceipt.claims.artifact.bytes;
    const location = matches ? record!.progress.progress?.location : undefined;
    return Object.freeze({format: finalBinding.format, ...(pageCount === undefined ? {} : {pageCount}),
      ...(location && location.format === finalBinding.format ? {location: Object.freeze({...location})} : {})});
  }
  publicationLease(entry: OfflineEntry, scope: Readonly<{signal: AbortSignal; current: () => boolean}>): NativeOfflinePublicationLease {
    const read = this.localRead(entry), owner = this.ownerKey(), initial = read();
    if (!native || !owner || !nativePublicationReadsAvailable() || this.playabilityReason(initial)) throw new Error('reading_unavailable');
    const binding = this.publicationBinding(initial.receipt), abort = new AbortController(); let disposed = false;
    const current = () => {try {const live = read(); return !disposed && !abort.signal.aborted && !scope.signal.aborted && scope.current() && !this.playabilityReason(live) && this.publicationBinding(live.receipt).documentSha256 === binding.documentSha256;} catch {return false;}};
    const retire = () => {if (disposed) return; disposed = true; abort.abort(); off(); clearTimeout(timer); scope.signal.removeEventListener('abort', retire);};
    const off = this.subscribe(() => {if (!current()) retire();});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = () => {if (!current()) {retire(); return;} timer = setTimeout(expiry, Math.max(1, Math.min(2147483647, Date.parse(read().receipt!.claims.expiresAt) - this.receiptNow())));};
    scope.signal.addEventListener('abort', retire, {once: true}); expiry();
    const assert = () => {if (!current()) throw new Error('reading_retired');};
    const journalName = (name: string) => {if (!/^reader-state-[A-Za-z0-9_-]{1,64}\.json$/.test(name)) throw new Error('reading_invalid_state');};
    let serial: Promise<unknown> = Promise.resolve();
    const state = <T,>(work: () => Promise<T>) => {const result = serial.then(async () => {assert(); const value = await work(); assert(); return value;}); serial = result.catch(() => {}); return result;};
    const lease: NativeOfflinePublicationLease = {entryId: entry.id, itemId: entry.itemId, owner, binding, signal: abort.signal, current,
      receipt: () => {assert(); return read().receipt!;},
      descriptor: () => state(() => native.readExtra(entry.id, 'publication.json')),
      readState: name => {journalName(name); return state(async () => {const value = await native.readExtra(entry.id, name); if (publicationUTF8(value).length > 1 << 20) throw new Error('reading_state_limit'); return value;});},
      writeState: (name, json) => {journalName(name); if (typeof json !== 'string' || publicationUTF8(json).length > 1 << 20) throw new Error('reading_state_limit'); JSON.parse(json); return state(() => native.writeExtra(entry.id, name, json));},
      dispose: retire,
    };
    if (!current()) {retire(); throw new Error('reading_retired');}
    return Object.freeze(lease);
  }
  async readingSession(entry: OfflineEntry, scope: Readonly<{signal: AbortSignal; current: () => boolean; paused: () => boolean}>): Promise<OfflineReadingSession> {
    const authority = this.publicationLease(entry, scope), owner = authority.owner, binding = authority.binding, receipt = authority.receipt(), current = authority.current;
    let raw: string; try {raw = await authority.descriptor();} catch (error) {authority.dispose(); throw error;}
    const records = bucket(this.stored.reading, owner);
    const matches = (record: ReadingRecord | undefined): record is ReadingRecord => !!record && record.itemId === entry.itemId && record.sourceId === binding.sourceId && record.revision === binding.revision && record.documentSha256 === binding.documentSha256 && record.artifactSha256 === receipt.claims.artifact.sha256 && record.artifactBytes === receipt.claims.artifact.bytes;
    try {return await openOfflineReadingSession({id: entry.id, owner, itemId: entry.itemId, raw, binding, artifact: receipt.claims.artifact, authority, current, signal: authority.signal, onClose: authority.dispose, now: () => this.receiptNow(),
      progress: initial => {const record = records[entry.id]; return matches(record) ? decodeGetReadingSessionsSessionIdProgressResponse(record.progress) : initial;},
      save: async (request, initialProgress, startedAt, callerCurrent): Promise<ReadingSavedProgress> => {
        if (!current() || !callerCurrent()) throw new Error('reading_retired');
        const previous = records[entry.id], existing = matches(previous) ? previous : undefined;
        if (scope.paused() || existing?.blockedStartedAt === startedAt) return {progress: existing?.progress.progress ?? initialProgress.progress, saved: false};
        const observedAt = Math.max(startedAt, this.receiptNow(), (existing?.pending?.observedAt ?? 0) + 1);
        if (!Number.isSafeInteger(observedAt) || request.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('invalid_location');
        const progress = decodeGetReadingSessionsSessionIdProgressResponse({progress: {sourceId: binding.sourceId, sourceRevision: binding.revision, location: request.location, revision: request.expectedRevision + 1, observedAt, stale: false}});
        const record: ReadingRecord = Object.freeze({itemId: entry.itemId, sourceId: binding.sourceId, revision: binding.revision, documentSha256: binding.documentSha256, artifactSha256: receipt.claims.artifact.sha256, artifactBytes: receipt.claims.artifact.bytes,
          receipt, serverRevision: existing?.serverRevision ?? initialProgress.progress?.revision ?? 0, progress,
          pending: Object.freeze({id: operationId(), observedAt, startedAt, location: request.location})});
        records[entry.id] = record;
        if (!await this.persist()) {if (records[entry.id] === record) {if (previous) records[entry.id] = previous; else delete records[entry.id];} throw new Error('reading_progress_not_saved');}
        if (!current() || !callerCurrent()) throw new Error('reading_retired');
        void this.syncReadingProgress(); return {progress: progress.progress, saved: true};
      },
    });} catch (error) {authority.dispose(); throw error;}
  }
  private readingSync?: {generation: number; task: Promise<void>};
  private syncReadingProgress(generation = this.generation): Promise<void> {
    if (this.readingSync?.generation === generation) return this.readingSync.task;
    const task = this.drainReadingProgress(generation); this.readingSync = {generation, task};
    void task.finally(() => {if (this.readingSync?.task === task) this.readingSync = undefined;}).catch(() => {}); return task;
  }
  private async drainReadingProgress(generation: number) {
    const api = this.api, owner = this.ownerKey(); if (!api || !owner || generation !== this.generation) return;
    const current = () => this.generation === generation && this.api === api && this.ownerKey() === owner;
    const records = this.stored.reading[owner]; if (!records) return;
    for (const [id, sent] of Object.entries(records).slice(0, 100)) {
      if (!current()) return;
      if (!sent || !sent.pending) continue;
      try {
        const original = decodeDownloadReceipt(sent.receipt);
        const originalClaims = original.receipt.claims;
        if (Date.parse(originalClaims.expiresAt) <= this.receiptNow()) {await this.renewReceipts(generation, api, owner, true); if (!current() || !records[id]) return;}
        const live = this.all.find(value => value.id === id && this.entryOwner(value) === owner && value.receipt);
        const decoded = decodeDownloadReceipt(live?.receipt ?? original.receipt), claims = decoded.receipt.claims;
        if (offlineOwnerKey(claims.viewer) !== owner || claims.itemId !== sent.itemId || claims.artifact.sha256 !== sent.artifactSha256 || claims.artifact.bytes !== sent.artifactBytes || !Number.isSafeInteger(sent.serverRevision) || sent.serverRevision < 0) continue;
        const binding = this.publicationBinding(decoded.receipt);
        if (binding.sourceId !== sent.sourceId || binding.revision !== sent.revision || binding.documentSha256 !== sent.documentSha256) continue;
        const key = this.stored.keys[decoded.receipt.keyId], originalKey = this.stored.keys[original.receipt.keyId];
        if (!key || !originalKey || !await nativeRouteCrypto.verify(base64url(key), decoded.signatureBytes, decoded.signedBytes) || !await nativeRouteCrypto.verify(base64url(originalKey), original.signatureBytes, original.signedBytes) || !current()) continue;
        const raw = await api.request<unknown>('/v1/reading/offline/progress', 'POST', {receipt: decoded.receipt, observationReceipt: original.receipt, expectedRevision: sent.serverRevision, observedAt: sent.pending.observedAt, startedAt: sent.pending.startedAt, location: sent.pending.location});
        if (!current() || !object(raw) || (raw.outcome !== 'applied' && raw.outcome !== 'history_paused' && raw.outcome !== 'stale_observation' && raw.outcome !== 'superseded_online')) return;
        if (Object.keys(raw).some(key => key !== 'progress' && key !== 'saved' && key !== 'outcome') || !Object.prototype.hasOwnProperty.call(raw, 'progress') || typeof raw.saved !== 'boolean') return;
        const result = decodePutReadingSessionsSessionIdProgressResponse({progress: raw.progress, saved: raw.saved});
        if (result.saved !== (raw.outcome === 'applied') || result.progress && (result.progress.sourceId !== sent.sourceId || !/^[0-9a-f]{64}$/.test(result.progress.sourceRevision) || !safeInteger(result.progress.revision, 1) || !safeInteger(result.progress.observedAt, 1))) return;
        const latest = records[id]; if (!latest || latest.sourceId !== sent.sourceId || latest.documentSha256 !== sent.documentSha256 || latest.artifactSha256 !== sent.artifactSha256) continue;
        const duplicate = raw.outcome === 'stale_observation' && result.progress?.observedAt === sent.pending.observedAt && JSON.stringify(result.progress.location) === JSON.stringify(sent.pending.location);
        const applied = raw.outcome === 'applied' || duplicate;
        const ownPending = latest.pending?.id === sent.pending.id;
        if (applied) records[id] = Object.freeze({...latest, serverRevision: result.progress?.revision ?? latest.serverRevision, pending: ownPending ? undefined : latest.pending});
        else if (ownPending) records[id] = Object.freeze({...latest, serverRevision: result.progress?.revision ?? latest.serverRevision, pending: undefined, progress: {progress: result.progress}, blockedStartedAt: sent.pending.startedAt});
        else {
          // A's refusal never acknowledges B, overwrites B's visible location,
          // or silently rebases B into a new intent. Keep B's original base.
          records[id] = Object.freeze({...latest, blockedStartedAt: sent.pending.startedAt});
        }
        await this.persist(); if (!current()) return;
      } catch {return;} // Network/authority failures never move another viewer's queue.
    }
  }
  async localMedia(entry: OfflineEntry): Promise<LocalMedia> {
    const reason = this.playable(entry); if (reason) throw new Error(reason);
    const current=this.localRead(entry);
    if (!native?.localFile) throw new Error(serviceText('downloads.offline.notPlayableHere'));
    const file = await native.localFile(entry.id);
    current();
    const extras=await this.extras(entry),live=current();
    const latestReason=this.playable(live);if(latestReason)throw new Error(latestReason);
    const playId = 'play_' + random();
    this.playing.set(entry.id, playId);
    return {entryId: live.id, itemId: live.itemId, playId, fileUrl: file.url, durationSeconds: Math.max(0, Number(file.durationSeconds) || 0), startSeconds: this.resumePoint(live), extras};
  }
  /** What came with a download: its description, chapters, markers and audio tracks as the server
   * described them, and its subtitle tracks as files on this device. */
  async extras(entry: OfflineEntry): Promise<OfflineExtras> {
    const dir = this.dirs.get(entry.id) ?? '', saved = new Set(this.metas.get(entry.id)?.extras ?? []);
    let bundle: DownloadBundle | undefined;
    try { const raw = await native?.readExtra(entry.id, 'bundle.json'); bundle = raw ? (JSON.parse(raw) as DownloadBundle) : undefined; } catch { bundle = undefined; }
    // Each track in the form closest to how it was authored that is whole on this device (a
    // VobSub track with both its files, a styled script with the fonts that came with it); text last.
    const subtitles = (bundle?.subtitles ?? []).flatMap(s => { const stored = dir ? storedSubtitle(s, saved, dir + 'extras/') : undefined; return stored ? [stored] : []; });
    const tiles = dir ? (bundle?.trickplay?.tiles ?? []).map((_, index) => trickplayTileName(index)) : [];
    const trickplayTiles = tiles.length && tiles.every(name => saved.has(name)) ? tiles.map(name => dir + 'extras/' + name) : [];
    const chapterImages: Record<number, string> = {};
    if (dir) for (const c of bundle?.chapters ?? []) if (c.image && saved.has(chapterImageName(c.index))) chapterImages[c.index] = dir + 'extras/' + chapterImageName(c.index);
    return Object.freeze({bundle, subtitles: Object.freeze(subtitles), backdropUrl: saved.has('backdrop') && dir ? dir + 'extras/backdrop' : '', trickplayTiles: Object.freeze(trickplayTiles), chapterImages: Object.freeze(chapterImages)});
  }
  private lastLocalWrite = new Map<string, number>();
  /** Progress from Portico's player for a downloaded title. A playing position is written at most
   * every 10 seconds; pauses, stops and the end always are. */
  recordProgress(progress: LocalProgress): void {
    const now = Date.now(), last = this.lastLocalWrite.get(progress.entryId) ?? 0;
    if (progress.state === 'playing' && now - last < 10000) return;
    this.lastLocalWrite.set(progress.entryId, now);
    if (this.lastLocalWrite.size > 32) this.lastLocalWrite.delete(this.lastLocalWrite.keys().next().value!);
    void this.observed({id: progress.entryId, playId: progress.playId, positionSeconds: progress.positionSeconds, durationSeconds: progress.durationSeconds, ended: progress.ended, final: progress.state !== 'playing'});
  }
  /** One observation of a play. Every play of a download is its own entry in the journal, kept
   * until the server has answered for it; its latest position replaces its earlier ones. */
  private async observed(event: {id: string; playId?: string; positionSeconds: number; durationSeconds: number; ended: boolean; final: boolean}) {
    const entry = this.all.find(e => e.id === event.id); if (!entry) return;
    // Filed under the viewer whose receipt authorised this playback, not under whoever is signed
    // in when the journal is finally sent. Playing offline is only permitted through `playable`,
    // so an entry reaching here has an owner.
    const owner = this.entryOwner(entry); if (!owner) return;
    const playId = event.playId ?? this.playing.get(entry.id) ?? 'play_' + random();
    this.playing.set(entry.id, playId);
    const position = Math.max(0, event.positionSeconds);
    const finished = event.ended || (event.durationSeconds > 0 && position / event.durationSeconds >= FINISHED_AT);
    bucket(this.stored.resume, owner)[entry.itemId] = finished ? 0 : position;
    const plays = bucket(this.stored.plays, owner);
    const clockKey = JSON.stringify([owner, entry.itemId]);
    const pendingTimes = Object.values(plays).filter(p => p.itemId === entry.itemId).map(p => Date.parse(p.observedAt)).filter(Number.isFinite);
    const observedAt = Math.max(Date.now(), Math.max(this.observationTimes.get(clockKey) ?? 0, ...pendingTimes) + 1);
    this.observationTimes.set(clockKey, observedAt);
    if (this.observationTimes.size > MAX_PLAYS) this.observationTimes.delete(this.observationTimes.keys().next().value!);
    plays[playId] = {playId, itemId: entry.itemId, positionSeconds: position, ...(event.ended ? {ended: true} : {}), observedAt: new Date(observedAt).toISOString()};
    const ids = Object.keys(plays);
    // The journal is bounded. Past the bound the oldest plays are let go: their titles' resume
    // points are already kept above, and what is lost is only their place in the history.
    for (const stale of ids.slice(0, Math.max(0, ids.length - MAX_PLAYS))) delete plays[stale];
    await this.persist();
    if (!event.final) return;
    void this.syncProgress();
    if (!finished) return;
    this.playing.delete(entry.id);
    if (this.stored.settings.autoNext) void this.autoNext(entry);
    if (this.stored.settings.deleteWatched) void this.remove(entry);
  }
  /** Sends plays made offline, for the connected viewer only. The server records each one and
   * keeps whichever state is newer. A play made by a different viewer stays queued until that
   * viewer connects; it is never posted under this one. */
  syncProgress(generation = this.generation): Promise<void> {
    if (this.progressSync?.generation === generation) return this.progressSync.task;
    const task = this.drainProgress(generation);
    this.progressSync = {generation, task};
    void task.finally(() => { if (this.progressSync?.task === task) this.progressSync = undefined; }).catch(() => {});
    return task;
  }
  private async drainProgress(generation: number) {
    const api = this.api, owner = this.ownerKey();
    if (generation !== this.generation || !api || !owner) return;
    while (this.generation === generation) {
      const entries = Object.values(this.stored.plays[owner] ?? {}).slice(0, 100);
      if (!entries.length) return;
      try {
        const receipt = parseDeferredProgressReceipt(await api.request<unknown>('/v1/downloads/progress', 'POST', {operationId: operationId(), entries: entries.map(e => durationIntent(e, {positionSeconds: 'positionMs'}))}));
        if (this.generation !== generation) return;
        // Anything the server answered about, accepted or not, is settled and must not be resent
        // (a play that has moved on since it was sent stays, to be sent again as it is now).
        const mine = this.stored.plays[owner];
        const acknowledged = entries.filter(e => receipt.entries.some(r => r.playId === e.playId && r.itemId === e.itemId));
        if (mine) for (const e of acknowledged) if (mine[e.playId] === e) delete mine[e.playId];
        // The server's answer is where each title now stands, whatever became of the entry: an
        // older play that lost to another device's leaves this copy resuming where that one is.
        const resume = bucket(this.stored.resume, owner);
        for (const result of receipt.entries) {
          if (!acknowledged.some(e => e.playId === result.playId && e.itemId === result.itemId)) continue;
          if (!result.itemId || result.outcome === 'item_deleted' || result.outcome === 'invalid_entry' || result.outcome === 'observation_in_future' || result.outcome === 'history_paused') continue;
          if (Object.values(mine ?? {}).some(p => p.itemId === result.itemId)) continue;
          resume[result.itemId] = result.watched ? 0 : result.positionSeconds;
        }
        await this.persist();
        if (acknowledged.length !== entries.length) return;
      } catch { return; /* Keep this and later batches for the next trigger. */ }
    }
  }
  /** Rejects, with the previous settings back in place, when the change can't be kept. */
  async setSettings(next: Partial<OfflineSettings>) {
    const previous = this.stored.settings;
    this.stored.settings = {...previous, ...next};
    if (next.wifiOnly !== undefined) await native?.setCellular(!next.wifiOnly).catch(() => {});
    if (await this.persist()) return;
    this.stored.settings = previous;
    if (next.wifiOnly !== undefined) await native?.setCellular(!previous.wifiOnly).catch(() => {});
    this.publish({settings: previous});
    throw new Error(serviceText('downloads.settingFailed'));
  }
}

function base64url(value: string): Uint8Array {
  const text = globalThis.atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  const out = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i); return out;
}
const sort = (entries: OfflineEntry[]) => entries.sort((a, b) => b.addedAt - a.addedAt);
export const offlineDownloads = new OfflineDownloads();

/** Downloads as a person looks for them: an episode under its show, a song under its album, a
 * part under its book, each group in its own order; everything else on its own. Groups and single
 * titles are ordered by what was added most recently. Built from what is on the device alone. */
export type OfflineGroup = Readonly<{key: string; title: string; artworkUrl: string; entries: readonly OfflineEntry[]}>;
export function groupOfflineEntries(entries: readonly OfflineEntry[]): readonly OfflineGroup[] {
  const groups = new Map<string, {title: string; entries: OfflineEntry[]}>();
  for (const entry of entries) {
    const info = entry.info;
    const grouped = !!info?.parentId && (info.kind === 'episode' || info.kind === 'song' || info.kind === 'audiobook_file');
    const key = grouped ? 'parent:' + info!.parentId : 'title:' + entry.id;
    const group = groups.get(key) ?? {title: grouped ? info!.parentTitle : '', entries: []};
    group.entries.push(entry);
    groups.set(key, group);
  }
  const place = (e: OfflineEntry) => (e.info?.groupNumber ?? 0) * 100000 + (e.info?.number ?? 0);
  return Object.freeze([...groups.entries()].map(([key, group]) => {
    const ordered = group.title ? [...group.entries].sort((a, b) => place(a) - place(b) || a.addedAt - b.addedAt) : group.entries;
    return Object.freeze({key, title: group.title, artworkUrl: ordered.find(e => e.artworkUrl)?.artworkUrl ?? '', entries: Object.freeze(ordered)});
  }).sort((a, b) => Math.max(...b.entries.map(e => e.addedAt)) - Math.max(...a.entries.map(e => e.addedAt))));
}
