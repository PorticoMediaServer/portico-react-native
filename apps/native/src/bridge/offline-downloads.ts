import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {enUS} from '../../../../packages/i18n/src/index';
import {nativeRouteCrypto} from './server-connections';
import {
  DownloadsService, decodeDownloadReceipt, getDownloadRequest, parseDeferredProgressReceipt, parseReceiptKeys, parseReceiptOutcomes, receiptUsable,
  type DownloadPreparation, type DownloadReceipt,
} from '../../../../packages/client-core/src/index';
import type {LocalMedia, LocalProgress} from './local-playback';

/** Downloads kept on this iPhone or iPad.
 *
 * The native module moves, verifies and stores files. This decides what may be played: a file
 * is playable offline only while it holds a receipt the server signed for this exact viewer,
 * and only until that receipt expires (the server renews it for another 30 days whenever the
 * app is online). Viewing done offline is remembered and sent to the server later, where an
 * online position that is newer wins. */

export type OfflineState = 'downloading' | 'paused' | 'failed' | 'ready';
/** What a receipt's verification covers: its key, signed payload and signature. */
const signedIdentity = (r: DownloadReceipt) => `${r.keyId}\u0000${r.payload}\u0000${r.signature}`;

/** The most receipts the server renews in one request. */
const RECEIPT_BATCH = 100;
/** The most pages of a container request's members (100 each) read in one pass. */
const ENROLL_PAGES_PER_PASS = 50;
/** The most members left waiting to be collected before more of a container request is read. They
 * are kept in the bookkeeping document, which the device refuses to save past a megabyte. */
const ENROLL_BACKLOG = 5000;

export type OfflineEntry = Readonly<{
  id: string; itemId: string; title: string; subtitle: string; quality: string; artworkUrl: string;
  state: OfflineState; error: string; bytes: number; bytesDone: number; addedAt: number;
  receipt?: DownloadReceipt; libraryId?: string; kind?: string;
  /** Owner recorded natively when the transfer started, for entries with no receipt yet. */
  owner?: string;
}>;
export type OfflineSettings = Readonly<{wifiOnly: boolean; deleteWatched: boolean; autoNext: boolean; limitBytes: number}>;
export type OfflineSnapshot = Readonly<{supported: boolean; ready: boolean; entries: readonly OfflineEntry[]; settings: OfflineSettings; freeBytes: number; usedBytes: number; pendingProgress: number; error?: string}>;
export type Viewer = Readonly<{authority: string; accountId: string; profileId: string; serverId: string}>;
type Api = {baseUrl: string; mediaUrl(path: string): string; request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>};
type Progress = {itemId: string; positionSeconds: number; watched?: boolean; observedAt: string};
export type OfflineDisplay = Readonly<{title: string; subtitle?: string; artworkUrl?: string; libraryId?: string; kind?: string}>;

/** Deferred work is filed under the viewer that produced it, never under whoever
 * is signed in when it is finally sent. `legacy` holds records written before
 * this device recorded owners. A file receipt cannot prove who produced an old
 * observation, so these remain unattributed and are never submitted or replayed. */
type Owned<T> = Record<string, Record<string, T>>;
type Stored = {
  version: number;
  settings: OfflineSettings;
  progress: Owned<Progress>;
  resume: Owned<number>;
  keys: Record<string, string>;
  wanted: Owned<OfflineDisplay>;
  nextAfter: Owned<{quality: string; libraryId?: string; kind?: string}>;
  legacy: {progress: Record<string, Progress>; resume: Record<string, number>; wanted: Record<string, OfflineDisplay>};
};

const native = NativeModules.PorticoDownloads as undefined | {
  list(): Promise<any[]>; start(request: Record<string, unknown>): Promise<any>; pause(id: string): Promise<void>; remove(id: string): Promise<void>;
  setMeta(id: string, meta: string): Promise<void>; storage(): Promise<{freeBytes: number; usedBytes: number}>; setCellular(allowed: boolean): Promise<void>;
  readState(): Promise<string>; writeState(json: string): Promise<void>; play(id: string, startSeconds: number): Promise<void>; stop(): Promise<void>;
  localFile(id: string): Promise<{url: string; durationSeconds: number}>;
};
const defaults: OfflineSettings = Object.freeze({wifiOnly: true, deleteWatched: false, autoNext: false, limitBytes: 0});
const operationId = () => 'op_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

/** One viewer on one server. Every local record and every native entry is filed
 * under this exact string, so "the same account on a different server" and "a
 * different profile on the same account" are different owners. */
export const offlineOwnerKey = (viewer: Viewer) =>
  JSON.stringify([viewer.authority, viewer.accountId, viewer.profileId, viewer.serverId]);

const emptyStored = (): Stored => ({
  version: 2, settings: defaults, progress: {}, resume: {}, keys: {}, wanted: {}, nextAfter: {},
  legacy: {progress: {}, resume: {}, wanted: {}},
});

/** Reads either shape. Version 1 kept one flat record per kind with no owner at
 * all; those entries move to `legacy` rather than being attributed to whoever
 * happens to open the app next. */
function readStored(parsed: any): Stored {
  const out = emptyStored();
  if (!parsed || typeof parsed !== 'object') return out;
  out.settings = {...defaults, ...(parsed.settings ?? {})};
  out.keys = parsed.keys ?? {};
  if (parsed.version === 2) {
    out.progress = parsed.progress ?? {};
    out.resume = parsed.resume ?? {};
    out.wanted = parsed.wanted ?? {};
    out.nextAfter = parsed.nextAfter ?? {};
    out.legacy = {progress: {}, resume: {}, wanted: {}, ...(parsed.legacy ?? {})};
    return out;
  }
  out.legacy = {progress: parsed.progress ?? {}, resume: parsed.resume ?? {}, wanted: parsed.wanted ?? {}};
  return out;
}

const bucket = <T,>(owned: Owned<T>, owner: string): Record<string, T> => (owned[owner] ??= {});
const failureText: Record<string, string> = {
  grant_expired: 'The download link expired before the transfer started. Try again.',
  server_refused: 'The server refused the transfer. Try again.',
  verification_failed: 'The file arrived damaged and was removed. Try again.',
  storage_full: 'There isn’t enough space on this device.',
  network: 'The connection dropped. It will continue when you try again.',
  transfer_failed: 'The transfer stopped. Try again.',
};
export const offlineFailure = (code: string) => failureText[code] ?? (code ? 'The download stopped. Try again.' : '');

/** Whether a refused revalidation means this viewer's own file must go.
 *
 * Every refusal except `unknown_receipt` follows the server revoking a receipt
 * it recognised as this viewer's, so the file is genuinely no longer allowed.
 * `unknown_receipt` is the one answer returned without any revocation: the
 * receipt row simply did not match the caller's profile key. That is what a
 * different profile's receipt looks like, so it is never grounds for deletion. */
const revokesOwnedFile = (code: string) => code !== '' && code !== 'unknown_receipt';

export class OfflineDownloads {
  private state: OfflineSnapshot = Object.freeze({supported: !!native && !Platform.isTV, ready: false, entries: [], settings: defaults, freeBytes: 0, usedBytes: 0, pendingProgress: 0});
  private listeners = new Set<() => void>();
  /** Everything on the device. `state.entries` is the subset the connected
   * viewer may see; this is the list ownership decisions are made against. */
  private all: OfflineEntry[] = [];
  private stored: Stored = emptyStored();
  /** Receipt ids whose signature has been checked against a key the server published. */
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
  private enrolled = new Map<string, {after: string; read: number; mark: string; tail: boolean; busy: boolean}>();
  private enrollTimer?: ReturnType<typeof setTimeout>;
  /** Members already enrolled, once each: a download deleted later (by hand or after watching)
   * is not wanted again because its request is still followed. */
  private enrolledItems = new Set<string>();
  private continuing = new Set<string>();
  /** Bumped by every connect and disconnect. Work started under an earlier
   * generation may finish, but may not write anything back. */
  private generation = 0;
  private opening?: Promise<void>;
  private progressSync?: {generation: number; task: Promise<void>};

  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<OfflineSnapshot>) { this.state = Object.freeze({...this.state, ...patch}); this.listeners.forEach(f => f()); }

  /** Who this download belongs to, or undefined when nothing on the device says.
   *
   * A receipt is the server's signed statement of ownership, so it wins over the
   * locally recorded owner. The signature itself is checked separately, by
   * `playable`: an unverified receipt still tells us which server and viewer to
   * talk to, which is all this is used for, and treating it as ownerless would
   * make a download unrenewable on a device that has not fetched keys yet. */
  private entryOwner(entry: OfflineEntry): string | undefined {
    if (entry.receipt) return offlineOwnerKey(entry.receipt.claims.viewer);
    return entry.owner || undefined;
  }
  private ownerKey() { return this.viewer ? offlineOwnerKey(this.viewer) : undefined; }
  /** Entries belonging to one owner. Nothing else may be renewed, submitted or removed for it. */
  private ownedEntries(owner: string) { return this.all.filter(e => this.entryOwner(e) === owner); }

  /** What the connected viewer may see: their own downloads, plus any this
   * device has no owner for at all.
   *
   * Only records written before this version can be unattributed — a receipt
   * names its viewer, and every transfer started since records one before the
   * first byte arrives — so this shows a viewer their own in-flight work after
   * an upgrade without ever listing another profile's titles. With no viewer
   * connected the device list is not published at all. */
  private visibleEntries(): OfflineEntry[] {
    const owner = this.ownerKey();
    if (!owner) return [];
    return this.all.filter(e => {
      const entryOwner = this.entryOwner(e);
      return entryOwner === undefined || entryOwner === owner;
    });
  }
  private publishEntries(next = this.all) {
    this.all = sort(next);
    this.publish({entries: this.visibleEntries()});
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
    this.subscriptions.push(emitter.addListener('PorticoDownloadPlayback', event => void this.observed(event)));
    const entries = (await native.list()).map(read).filter((e): e is OfflineEntry => !!e);
    this.all = sort(entries);
    this.publish({ready: true, entries: this.visibleEntries(), settings: this.stored.settings});
    // Persist the conservative v1 migration without assigning legacy work.
    await this.persist();
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
    if (viewer) void this.open().catch(() => this.publish({error: enUS['downloads.deviceUnreadable']}));
    this.publish({entries: this.visibleEntries(), pendingProgress: this.pendingCount()});
  }
  /** Binds the signed-in server, so receipts can be renewed and offline viewing sent up. */
  connect(api: Api, service: DownloadsService, viewer: Viewer) {
    this.adopt(viewer);
    const generation = ++this.generation;
    this.api = api; this.service = service;
    this.unfollow?.(); this.unfollow = service.subscribe(() => void this.collect());
    void this.open().then(async () => {
      if (this.generation !== generation) return;
      const owner = offlineOwnerKey(viewer);
      await this.refreshKeys(generation, api);
      if (this.generation !== generation) return;
      this.publish({entries: this.visibleEntries(), pendingProgress: this.pendingCount()});
      void this.renewReceipts(generation, api, owner);
      void this.syncProgress(generation);
      void this.collect();
      void this.continueNext(generation);
      // Ask for a receipt for this viewer's own ready downloads, and for any
      // whose owner this device never recorded. The second case is safe to ask
      // about because issuance is owner-scoped on the server — it matches the
      // preparation against this viewer's profile key — so only the real owner
      // is ever given one, and an unowned entry cannot be claimed by asking.
      for (const e of this.all) {
        if (e.state !== 'ready' || e.receipt) continue;
        const entryOwner = this.entryOwner(e);
        if (entryOwner === undefined || entryOwner === owner) void this.obtainReceipt(e.id, generation);
      }
    });
  }
  /** Drops the server binding while preserving the saved viewer for authorized
   * offline access. Sign-out clears it explicitly through `adopt(undefined)`. */
  disconnect() { this.generation++; this.unfollow?.(); this.unfollow = undefined; this.api = undefined; this.service = undefined; }
  dispose() { this.subscriptions.forEach(s => s.remove()); this.subscriptions = []; this.listeners.clear(); }

  private accept(raw: any) {
    if (raw?.state === 'removed') { this.publishEntries(this.all.filter(e => e.id !== raw.id)); void this.measure(); return; }
    const next = read(raw); if (!next) return;
    const before = this.all.find(e => e.id === next.id);
    this.publishEntries([...this.all.filter(e => e.id !== next.id), next]);
    // A new or renewed receipt is verified by its own signed content (never inherited by id).
    if (next.receipt && (!before?.receipt || signedIdentity(before.receipt) !== signedIdentity(next.receipt))) void this.verifyAll();
    if (next.state === 'ready' && before?.state !== 'ready') {
      void this.measure();
      // Only ask for a receipt for a download this viewer may claim. Issuance is
      // owner-scoped on the server, so an unowned legacy entry is safe to ask about.
      const owner = this.entryOwner(next);
      if (!next.receipt && (owner === undefined || owner === this.ownerKey())) void this.obtainReceipt(next.id);
    }
  }
  private async measure() { if (!native) return; try { const s = await native.storage(); this.publish({freeBytes: s.freeBytes, usedBytes: s.usedBytes}); } catch {} }
  /** Unsent observations for the connected viewer. Another viewer's queue is not
   * this viewer's business and is not counted into their badge. */
  private pendingCount() {
    const owner = this.ownerKey();
    return owner ? Object.keys(this.stored.progress[owner] ?? {}).length : 0;
  }
  /** Writes the bookkeeping document. A failed write is reported rather than published as
   * saved: the Downloads screen shows it until a later write succeeds. */
  private async persist(): Promise<boolean> {
    const saved = native ? await native.writeState(JSON.stringify(this.stored)).then(() => true, () => false) : true;
    const unwritable = enUS['downloads.deviceUnwritable'];
    const error = saved ? (this.state.error === unwritable ? undefined : this.state.error) : unwritable;
    this.publish({settings: this.stored.settings, pendingProgress: this.pendingCount(), error});
    return saved;
  }

  /** Remembers how a title looks at the moment it is asked for, so that when the server has
   * prepared it the file comes to this device by itself, under its real name and artwork. */
  async want(itemIds: readonly string[], display?: OfflineDisplay, originatingService?: DownloadsService) {
    if (originatingService && originatingService !== this.service) return;
    const owner = this.ownerKey(), generation = this.generation;
    if (!this.state.supported || !owner) return;
    const mine = bucket(this.stored.wanted, owner);
    for (const id of itemIds) mine[id] = itemIds.length === 1 && display ? display : {title: ''};
    await this.persist();
    if (this.generation === generation) void this.collect(generation);
  }
  display(preparation: DownloadPreparation): OfflineDisplay {
    const owner = this.ownerKey();
    const wanted = owner ? this.stored.wanted[owner]?.[preparation.itemId] : undefined;
    return {...wanted, title: wanted?.title || preparation.artifact.fileName.replace(/\.[a-z0-9]{2,5}$/i, '') || 'Download', libraryId: wanted?.libraryId ?? preparation.libraryId};
  }
  /** Fetches whatever the connected viewer asked for from this device and is now ready. One
   * that cannot be fetched (no space, over the limit) stays on the list with the reason and a
   * button. Another viewer's outstanding wants are left untouched until they connect. */
  private async collect(generation = this.generation) {
    const owner = this.ownerKey(), service = this.service;
    if (generation !== this.generation || !service || !this.state.ready || !owner) return;
    await this.enrollRequests(owner, service, generation).catch(() => {});
    if (generation !== this.generation) return;
    const mine = this.stored.wanted[owner]; if (!mine) return;
    let collected = false;
    for (const p of service.getSnapshot().items) {
      if (this.generation !== generation) return;
      const display = mine[p.itemId];
      if (!display || p.state !== 'ready' || this.collecting.has(p.id) || this.all.some(e => e.id === p.id) || this.blocked(p)) continue;
      this.collecting.add(p.id);
      try {
        await this.fetch(p, this.display(p));
        if (this.generation !== generation) return;
        delete this.stored.wanted[owner]?.[p.itemId];
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
   * Members past the first page (100) are read a bounded batch of pages at a time. Each batch
   * carries on after the last member read, and what it enrolled is saved before the next one
   * starts, so a very large request is neither cut short nor read from the start again. Reading
   * waits while the list of members still to be collected is full, and goes on as they arrive, so
   * that list stays bounded however large the request is. Once the last page is reached it is
   * looked at again only when the request's counts change, which is how members the server lists
   * later are found. */
  private async enrollRequests(owner: string, service: DownloadsService, generation: number) {
    const mine = bucket(this.stored.wanted, owner), api = this.api;
    let added = false, more = false;
    for (const tracked of service.getSnapshot().requests) {
      const r = tracked.request;
      const add = (items: readonly {itemId: string}[]) => {
        for (const it of items) {
          const key = `${owner}|${r.requestId}|${it.itemId}`;
          if (this.enrolledItems.has(key)) continue;
          this.enrolledItems.add(key);
          if (!mine[it.itemId] && !this.all.some(e => e.itemId === it.itemId)) { mine[it.itemId] = {title: ''}; added = true; }
        }
      };
      add(r.items);
      if (!r.nextCursor || !api) continue;
      const mark = `${r.total}/${r.ready}/${r.preparing}/${r.queued}`;
      const reading = this.enrolled.get(r.requestId) ?? {after: r.nextCursor, read: 0, mark: '', tail: false, busy: false};
      this.enrolled.set(r.requestId, reading);
      // Another pass is reading this request, or it has been read to its end (or to a page that
      // could not be read) and nothing about it has changed since.
      if (reading.busy || (reading.tail && reading.mark === mark)) continue;
      const restart = () => { reading.after = r.nextCursor; reading.read = 0; reading.tail = true; };
      reading.mark = mark; reading.tail = false; reading.busy = true;
      let held = false;
      try {
        for (let i = 0; i < ENROLL_PAGES_PER_PASS && !reading.tail; i++) {
          if (Object.keys(mine).length >= ENROLL_BACKLOG) { held = true; break; }
          const page = await getDownloadRequest(api, r.requestId, {cursor: reading.after});
          if (generation !== this.generation) return;
          add(page.items);
          reading.read += page.items.length;
          // More members than the request has: its list changed under the reading (or the server
          // is repeating itself). Stop, and read from the first page when it next changes.
          if (r.items.length + reading.read > page.total) restart();
          else if (!page.nextCursor || page.nextCursor === reading.after || !page.items.length) { reading.read -= page.items.length; reading.tail = true; }
          else reading.after = page.nextCursor;
        }
        if (!reading.tail && !held) more = true;
      } catch (e) {
        // A page that cannot be read waits for the request to change; the reading then carries on
        // from the same place. A place the server no longer knows (400) starts from the first page.
        if ((e as {status?: unknown} | null)?.status === 400) restart(); else reading.tail = true;
      } finally { reading.busy = false; }
    }
    if (added) await this.persist();
    // The rest of a large request is the next batch's.
    if (more) this.enrollSoon(generation);
  }
  /** APP-09: finishing a title asks the server to prepare the next one, and the
   * accepted items become this viewer's local wants — the same two steps the
   * download sheet performs. Without the second step the server prepares an
   * episode the collector will never look at. */
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
        if (batch.items.length) await this.want(batch.items.map(p => p.itemId), {title: '', libraryId: intent.libraryId, kind: intent.kind});
        if (generation !== this.generation) return;
        if (this.stored.nextAfter[owner]?.[itemId] === intent) delete this.stored.nextAfter[owner]![itemId];
        await this.persist();
      } catch { /* durable intent is retried on the next connection */ }
      finally { this.continuing.delete(key); }
    }
  }

  /** Bytes promised to transfers that haven't finished: counted against the limit (whole files)
   * and against free space (what is still to arrive), so starting several at once can't overshoot. */
  private starting = new Map<string, number>();
  private inFlight() {
    let whole = 0, remaining = 0;
    for (const e of this.all) if (e.state === 'downloading' || e.state === 'paused') { whole += e.bytes; remaining += Math.max(0, e.bytes - e.bytesDone); }
    for (const [id, bytes] of this.starting) if (!this.all.some(e => e.id === id)) { whole += bytes; remaining += bytes; }
    return {whole, remaining};
  }
  /** Why a server-prepared file cannot be fetched right now, or '' when it can. */
  blocked(preparation: DownloadPreparation): string {
    if (preparation.state !== 'ready') return 'The server is still preparing this.';
    const size = preparation.artifact.bytes, limit = this.state.settings.limitBytes, pending = this.inFlight();
    if (limit > 0 && this.state.usedBytes + pending.whole + size > limit) return 'This would go over your download limit. Remove something, or raise the limit.';
    if (this.state.freeBytes > 0 && size + pending.remaining + 500 * 1048576 > this.state.freeBytes) return 'There isn’t enough space on this device.';
    return '';
  }
  async fetch(preparation: DownloadPreparation, display: OfflineDisplay = this.display(preparation)): Promise<void> {
    const owner = this.ownerKey(), api = this.api, service = this.service, generation = this.generation;
    if (!native || !service || !api || !owner) throw new Error('Connect to your server to start a download.');
    const reason = this.blocked(preparation); if (reason) throw new Error(reason);
    this.starting.set(preparation.id, preparation.artifact.bytes);
    try { await this.startTransfer(preparation, display, owner, api, service, generation); } finally { this.starting.delete(preparation.id); }
  }
  private async startTransfer(preparation: DownloadPreparation, display: OfflineDisplay, owner: string, api: Api, service: DownloadsService, generation: number) {
    if (!native) throw new Error('Downloads aren’t available on this device.');
    const grant = await service.grant(preparation);
    if (this.generation !== generation) throw new Error('Your connection changed. Connect to your server to start this download.');
    await native.start({
      id: preparation.id, url: api.mediaUrl(grant.url), fileName: grant.artifact.fileName, bytes: grant.artifact.bytes, sha256: grant.artifact.sha256,
      contentType: grant.artifact.contentType, itemId: preparation.itemId, title: display.title, subtitle: display.subtitle ?? '', quality: preparation.quality,
      // The owner is recorded before the first byte arrives, so a transfer that
      // is still running when the viewer changes is not left unattributed.
      artworkUrl: display.artworkUrl ?? '', meta: JSON.stringify({libraryId: display.libraryId ?? preparation.libraryId, kind: display.kind ?? '', owner}),
    });
  }
  /** A paused or failed transfer continues from where it stopped when the device kept the
   * partial file; the address is always fresh because grants are short-lived. */
  async resume(entry: OfflineEntry, preparation?: DownloadPreparation) {
    if (!preparation) throw new Error('Connect to your server to continue this download.');
    await this.fetch(preparation, {title: entry.title, subtitle: entry.subtitle, artworkUrl: entry.artworkUrl, libraryId: entry.libraryId, kind: entry.kind});
  }
  pause(entry: OfflineEntry) { return native?.pause(entry.id) ?? Promise.resolve(); }
  async remove(entry: OfflineEntry) {
    await native?.remove(entry.id);
    const owner = this.entryOwner(entry);
    if (owner) delete this.stored.resume[owner]?.[entry.itemId]; else delete this.stored.legacy.resume[entry.itemId];
    await this.persist();
  }

  private async obtainReceipt(id: string, generation = this.generation) {
    if (generation !== this.generation || !native || !this.api || this.receiving.has(id)) return;
    const api = this.api;
    this.receiving.add(id);
    try {
      const outcomes = parseReceiptOutcomes(await api.request<unknown>('/v1/downloads/receipts', 'POST', {operationId: operationId(), preparationIds: [id]}));
      if (this.generation !== generation) return;
      const issued = outcomes.find(o => o.preparationId === id && o.receipt);
      if (issued?.receipt) await this.storeReceipt(id, issued.receipt, generation);
    } catch { /* tried again the next time the app is online */ } finally { this.receiving.delete(id); }
  }
  private async storeReceipt(id: string, receipt: DownloadReceipt, generation: number) {
    if (generation !== this.generation) return;
    const entry = this.all.find(e => e.id === id); if (!entry || !native) return;
    // The receipt's signed viewer is the durable owner; the recorded owner is
    // kept in step so an entry stays attributed if its receipt is ever dropped.
    const owner = offlineOwnerKey(receipt.claims.viewer);
    await native.setMeta(id, JSON.stringify({libraryId: entry.libraryId ?? '', kind: entry.kind ?? '', owner, receipt}));
    if (generation !== this.generation) return;
    await this.verifyAll();
  }
  /** Extends this viewer's receipts while online, and drops what the server has
   * revoked for them. Another viewer's downloads are not submitted at all: the
   * server cannot recognise a receipt issued to someone else, and treating that
   * answer as permission to delete is how one profile erased another's files. */
  private async renewReceipts(generation = this.generation, apiArg = this.api, ownerArg = this.ownerKey()) {
    const api = apiArg, owner = ownerArg;
    if (generation !== this.generation || !api || !owner) return;
    const held = this.ownedEntries(owner).filter(e => e.receipt);
    // The server renews at most 100 receipts per request, so a large library of downloads is
    // renewed in batches (one oversized request was refused whole, and every receipt expired).
    for (let i = 0; i < held.length; i += RECEIPT_BATCH) {
      const batch = held.slice(i, i + RECEIPT_BATCH);
      try {
        const outcomes = parseReceiptOutcomes(await api.request<unknown>('/v1/downloads/receipts/revalidate', 'POST', {operationId: operationId(), receiptIds: batch.map(e => e.receipt!.receiptId)}));
        if (this.generation !== generation) return;
        for (const o of outcomes) {
          if (this.generation !== generation) return;
          const entry = batch.find(e => e.receipt!.receiptId === o.receiptId); if (!entry) continue;
          if (o.outcome === 'renewed' && o.receipt) await this.storeReceipt(entry.id, o.receipt, generation);
          else if (o.outcome === 'refused' && revokesOwnedFile(o.code)) await this.remove(entry);
        }
      } catch { return; /* offline or busy: receipts stay valid until they expire */ }
    }
  }

  /** The server's receipt-signing keys, remembered so a receipt can be checked with no
   * connection. A receipt whose signature does not verify is treated as no receipt. */
  private async refreshKeys(generation: number, api: Api) {
    if (generation !== this.generation) return;
    try {
      const keys = parseReceiptKeys(await api.request<unknown>('/v1/downloads/receipt-keys'));
      if (generation !== this.generation) return;
      for (const key of keys) this.stored.keys[key.id] = key.publicKey;
      await this.persist();
      if (generation !== this.generation) return;
      await this.verifyAll();
    } catch { /* the remembered keys still work */ }
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
    this.publish({entries: this.visibleEntries()});
  }

  /** Whether this download may be played now, and if not, why. Usable with no connection. */
  playable(entry: OfflineEntry, viewer: Viewer | undefined = this.viewer): string {
    if (!viewer) return 'Sign in to the profile that downloaded this title.';
    if (entry.state !== 'ready') return 'This download isn’t finished.';
    if (!entry.receipt) return 'Connect to your server once to finish setting up this download.';
    if (!this.verified.has(signedIdentity(entry.receipt))) return 'Connect to your server once to finish setting up this download.';
    if (!receiptUsable(entry.receipt.claims, viewer, new Date())) return Date.parse(entry.receipt.claims.expiresAt) <= Date.now() ? 'This download needs to check in with your server. Connect once to keep watching it offline.' : 'This download belongs to a different profile.';
    return '';
  }
  async play(entry: OfflineEntry) {
    const reason = this.playable(entry); if (reason) throw new Error(reason);
    const owner = this.entryOwner(entry);
    // Resume where this entry's own viewer left off. A legacy position is only
    // read for an entry no owner has been established for, so one profile can
    // never resume from another's saved position.
    const position = owner ? this.stored.resume[owner]?.[entry.itemId] : this.stored.legacy.resume[entry.itemId];
    await native!.play(entry.id, position ?? 0);
  }
  /** OS-07: the downloaded file and this viewer's resume point, for Portico's own player. Checked
   * exactly as the system player's play was; no connection needed. */
  async localMedia(entry: OfflineEntry): Promise<LocalMedia> {
    const reason = this.playable(entry); if (reason) throw new Error(reason);
    if (!native?.localFile) throw new Error('This download can’t be played on this device.');
    const file = await native.localFile(entry.id);
    const owner = this.entryOwner(entry);
    const position = owner ? this.stored.resume[owner]?.[entry.itemId] : this.stored.legacy.resume[entry.itemId];
    return {entryId: entry.id, itemId: entry.itemId, fileUrl: file.url, durationSeconds: Math.max(0, Number(file.durationSeconds) || 0), startSeconds: Math.max(0, position ?? 0)};
  }
  private lastLocalWrite = new Map<string, number>();
  /** OS-07: progress from Portico's player for a downloaded title, kept as the system player's was
   * (resume point, offline journal for the server, auto-next and delete-watched on the end). A
   * playing position is written at most every 10 seconds; pauses, stops and the end always are. */
  recordProgress(progress: LocalProgress): void {
    const now = Date.now(), last = this.lastLocalWrite.get(progress.entryId) ?? 0;
    if (progress.state === 'playing' && now - last < 10000) return;
    this.lastLocalWrite.set(progress.entryId, now);
    if (this.lastLocalWrite.size > 32) this.lastLocalWrite.delete(this.lastLocalWrite.keys().next().value!);
    void this.observed({id: progress.entryId, positionSeconds: progress.positionSeconds, durationSeconds: progress.durationSeconds, ended: progress.ended});
  }
  private async observed(event: {id: string; positionSeconds: number; durationSeconds: number; ended: boolean}) {
    const entry = this.all.find(e => e.id === event.id); if (!entry) return;
    const watched = event.ended || (event.durationSeconds > 0 && event.positionSeconds / event.durationSeconds >= 0.92);
    // Filed under the viewer whose receipt authorised this playback, not under
    // whoever is signed in when the queue is finally sent. Playing offline is
    // only permitted through `playable`, so an entry reaching here has an owner;
    // anything still unattributed is held in `legacy` and never submitted.
    const owner = this.entryOwner(entry);
    const progress: Progress = {itemId: entry.itemId, positionSeconds: Math.max(0, event.positionSeconds), ...(watched ? {watched: true} : {}), observedAt: new Date().toISOString()};
    if (owner) {
      bucket(this.stored.resume, owner)[entry.itemId] = watched ? 0 : event.positionSeconds;
      bucket(this.stored.progress, owner)[entry.itemId] = progress;
    } else {
      this.stored.legacy.resume[entry.itemId] = watched ? 0 : event.positionSeconds;
      this.stored.legacy.progress[entry.itemId] = progress;
    }
    await this.persist();
    if (event.ended) {
      void this.syncProgress();
      if (this.stored.settings.autoNext) void this.autoNext(entry);
      if (this.stored.settings.deleteWatched) void this.remove(entry);
    }
  }
  /** Sends viewing done offline, for the connected viewer only. The server keeps
   * whichever position is newer. A record produced by a different viewer stays
   * queued until that viewer connects; it is never posted under this one. */
  syncProgress(generation = this.generation): Promise<void> {
    if (this.progressSync?.generation === generation) return this.progressSync.task;
    const task = this.drainProgress(generation);
    this.progressSync = {generation, task};
    void task.finally(() => { if (this.progressSync?.task === task) this.progressSync = undefined; });
    return task;
  }
  private async drainProgress(generation: number) {
    const api = this.api, owner = this.ownerKey();
    if (generation !== this.generation || !api || !owner) return;
    while (this.generation === generation) {
      const entries = Object.values(this.stored.progress[owner] ?? {}).slice(0, 100);
      if (!entries.length) return;
      try {
        parseDeferredProgressReceipt(await api.request<unknown>('/v1/downloads/progress', 'POST', {operationId: operationId(), entries}));
        if (this.generation !== generation) return;
        // Anything the server answered about, accepted or not, is settled and must not be resent.
        const mine = this.stored.progress[owner];
        if (mine) for (const e of entries) if (mine[e.itemId]?.observedAt === e.observedAt) delete mine[e.itemId];
        await this.persist();
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
    throw new Error(enUS['downloads.settingFailed']);
  }
}

function read(raw: any): OfflineEntry | undefined {
  if (!raw || typeof raw.id !== 'string' || !['downloading', 'paused', 'failed', 'ready'].includes(raw.state)) return undefined;
  let meta: any = {}; try { meta = raw.meta ? JSON.parse(raw.meta) : {}; } catch {}
  let receipt: DownloadReceipt | undefined;
  // A stored receipt is re-parsed every time it is read: a damaged one is no receipt at all.
  try { receipt = meta.receipt ? decodeDownloadReceipt(meta.receipt).receipt : undefined; } catch { receipt = undefined; }
  return Object.freeze({id: raw.id, itemId: String(raw.itemId ?? ''), title: String(raw.title ?? 'Download'), subtitle: String(raw.subtitle ?? ''), quality: String(raw.quality ?? ''), artworkUrl: String(raw.artworkUrl ?? ''),
    state: raw.state, error: String(raw.error ?? ''), bytes: Number(raw.bytes) || 0, bytesDone: Number(raw.bytesDone) || 0, addedAt: Number(raw.addedAt) || 0, receipt,
    libraryId: meta.libraryId || undefined, kind: meta.kind || undefined,
    owner: typeof meta.owner === 'string' && meta.owner ? meta.owner : undefined});
}
function base64url(value: string): Uint8Array {
  const text = globalThis.atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  const out = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i); return out;
}
const sort = (entries: OfflineEntry[]) => entries.sort((a, b) => b.addedAt - a.addedAt);
export const offlineDownloads = new OfflineDownloads();
