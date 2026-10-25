import type {LocalSession} from '../../../../../packages/client-core/src';
import type {ReadingAnnotation, ReadingAnnotationContent} from '../../../../../packages/client-core/src/reading-annotations';
import {NativeQueueStore} from '../../platform/queue-storage';

/** The private, bounded offline annotation journal (P1-READ-OFFLINE-ANNOTATION-SYNC).
 *
 * HOLD: `NATIVE_OFFLINE_ANNOTATION_AUTHORING` is false. This module and its callers are
 * withheld from the reader until the seven post-merge findings are reviewed; no canAnnotate
 * synthesis, journal mutation fallback or automatic flush is active. Queued private records
 * are never erased by this hold.
 *
 * The server's per-source annotation set stays the only record of truth. This journal holds
 * edits this device could not deliver and the last *complete* server page it saw, so a
 * downloaded publication can be annotated with the existing reader UI while its lease is
 * the only source, and merged by the real session on reconnect. It is never a second
 * annotations store of record and never serves the reader in place of a reachable server.
 *
 * Storage is one protected record per profile: the OfflineCore publication lease's own
 * private state namespace for a downloaded source (`reader-state-annotations.json`, bound by
 * that lease to its exact entry/profile/server/receipt/document), or the native protected
 * record store for an ordinary session. Neither place is a general file, logged, or
 * addressable by URL.
 *
 * Review findings #1, #2, #4-#7 are addressed here: assertions throw and carry the caller's
 * cancellation, every record mutation is an immutable ticket (no unbind fallback), a foreign
 * identity is refused instead of overwritten, the key is collision-resistant and the legacy
 * key is migrated without deleting the source, and no path ever writes `null`/an emptied
 * record except the explicit `discard`. #3 and #7's merge/completeness halves live in
 * `annotation-sync.ts`/`annotation-offline-port.ts`. */

export const ANNOTATION_JOURNAL_VERSION = 1 as const;
export const ANNOTATION_LEASE_STATE = 'reader-state-annotations.json';
const MAX_RECORD_BYTES = 180_000;
export const MAX_JOURNAL_OPERATIONS = 256;
export const MAX_JOURNAL_GROUPS = 16;
/** A cached page is a convenience, never the record of truth. It is stored only when the
 * *whole* server set was read and fits; a partial cache is never presented as complete. */
export const MAX_CACHE_ENTRIES = 50;
const MAX_CACHE_BYTES = 64_000;

export type NativeAnnotationIdentity = Readonly<{serverId: string; accountId: string; profileId: string}>;
export type NativeAnnotationFormat = 'epub' | 'pdf' | 'cbz';
export type NativeAnnotationSource = Readonly<{itemId: string; sourceId: string; sourceRevision: string; format: NativeAnnotationFormat}>;
export type NativeAnnotationUnresolved = 'stale-source' | 'source-changed' | 'server-newer' | 'deleted-elsewhere' | 'conflict' | 'refused';
export type NativeAnnotationOperation = Readonly<{
  id: string;
  delete: boolean;
  content?: ReadingAnnotationContent;
  observedAt: number;
  /** The server annotation-set revision this edit was made against. */
  baseRevision: number;
  /** The server's `updatedAt` for this id at that base; 0 when it did not exist. */
  baseUpdatedAt: number;
  /** A mutation for this operation was actually put on the wire at least once. After an
   * attempt, an absent entry no longer proves the operation was never created. */
  attempted?: boolean;
  unresolved?: NativeAnnotationUnresolved;
}>;
/** `complete: true` means this is the whole server set at `revision`, in one bounded page. */
export type NativeAnnotationCache = Readonly<{revision: number; entries: readonly ReadingAnnotation[]; complete: true}>;
export type NativeAnnotationGroup = Readonly<{
  source: NativeAnnotationSource;
  operations: readonly NativeAnnotationOperation[];
  localRevision: number;
  cache?: NativeAnnotationCache;
}>;
export type NativeAnnotationRecord = Readonly<{version: 1; identity: NativeAnnotationIdentity; groups: readonly NativeAnnotationGroup[]}>;
export type NativeAnnotationOperationRef = Readonly<{id: string; observedAt: number}>;
export type NativeAnnotationResolution = NativeAnnotationOperationRef & (
  | Readonly<{outcome: 'applied' | 'resolved'}>
  | Readonly<{outcome: 'unresolved'; reason: NativeAnnotationUnresolved}>);
export type NativeAnnotationView = Readonly<{revision: number; entries: readonly ReadingAnnotation[]; complete: boolean}>;

/** The OfflineCore publication lease's private state namespace, structurally. */
export type NativeAnnotationLeaseState = Readonly<{
  current: () => boolean;
  readState: (name: string) => Promise<string>;
  writeState: (name: string, json: string) => Promise<void>;
}>;

type Update = (current: NativeAnnotationRecord | undefined) => NativeAnnotationRecord;
type Change = (update: Update, assert?: () => void, signal?: AbortSignal) => Promise<void>;
type Backend = Readonly<{read: (assert?: () => void, signal?: AbortSignal) => Promise<NativeAnnotationRecord | undefined>; change: Change}>;

const RETIRED = 'native_annotation_journal_retired';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const sameIdentity = (a: NativeAnnotationIdentity, b: NativeAnnotationIdentity) => a.serverId === b.serverId && a.accountId === b.accountId && a.profileId === b.profileId;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && new TextEncoder().encode(value).length <= max;
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const format = (value: unknown): value is NativeAnnotationFormat => value === 'epub' || value === 'pdf' || value === 'cbz';
const reason = (value: unknown): value is NativeAnnotationUnresolved => value === 'stale-source' || value === 'source-changed' || value === 'server-newer'
  || value === 'deleted-elsewhere' || value === 'conflict' || value === 'refused';
const aborted = (signal?: AbortSignal) => {if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error('native_annotation_journal_retired'), {name: 'AbortError'});};

/** Two independent 32-bit hashes make the profile key collision-resistant; the stored
 * identity is still checked and a mismatch refuses the operation (never treated as absent). */
export function nativeAnnotationJournalKey(identity: NativeAnnotationIdentity): string {
  const input = `${identity.serverId}\u0000${identity.accountId}\u0000${identity.profileId}`;
  let a = 0x811c9dc5, b = 0x85ebca6b;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + 0x9e3779b9), 0x01000193) >>> 0;
  }
  return `reading-annotations:v1:${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}
/** The pre-fix 32-bit key. Its records are migrated once, then removed only after the new
 * record is written, so nothing queued is ever lost by the naming correction. */
const legacyJournalKey = (identity: NativeAnnotationIdentity): string => {
  let hash = 0x811c9dc5;
  const input = `${identity.serverId}\u0000${identity.accountId}\u0000${identity.profileId}`;
  for (let index = 0; index < input.length; index++) {hash ^= input.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0;}
  return `reading-annotations:v1:${hash.toString(16).padStart(8, '0')}`;
};

export const nativeAnnotationIdentity = (viewer: LocalSession['viewer']): NativeAnnotationIdentity =>
  Object.freeze({serverId: viewer.serverId, accountId: viewer.accountId, profileId: viewer.profileId});

function annotationContent(raw: unknown): ReadingAnnotationContent {
  if (!object(raw) || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id) || (raw.kind !== 'bookmark' && raw.kind !== 'highlight')
    || !text(raw.text, 8192) || !text(raw.note, 4096) || (raw.colour !== '' && raw.colour !== 'yellow' && raw.colour !== 'green' && raw.colour !== 'blue' && raw.colour !== 'pink')
    || !object(raw.location)) throw new Error('native_annotation_journal_invalid');
  return raw as ReadingAnnotationContent;
}
function annotationEntry(raw: unknown): ReadingAnnotation {
  if (!object(raw) || !integer(raw.createdAt) || !integer(raw.updatedAt) || raw.updatedAt < raw.createdAt) throw new Error('native_annotation_journal_invalid');
  return Object.freeze({...annotationContent(raw), createdAt: raw.createdAt, updatedAt: raw.updatedAt});
}
function operation(raw: unknown): NativeAnnotationOperation {
  if (!object(raw) || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id) || typeof raw.delete !== 'boolean'
    || !integer(raw.observedAt) || !integer(raw.baseRevision) || !integer(raw.baseUpdatedAt)
    || raw.attempted !== undefined && typeof raw.attempted !== 'boolean'
    || raw.unresolved !== undefined && !reason(raw.unresolved)) throw new Error('native_annotation_journal_invalid');
  return Object.freeze({id: raw.id, delete: raw.delete, observedAt: raw.observedAt, baseRevision: raw.baseRevision, baseUpdatedAt: raw.baseUpdatedAt,
    ...(raw.attempted === true ? {attempted: true} : {}), ...(raw.unresolved === undefined ? {} : {unresolved: raw.unresolved}),
    ...(raw.delete ? {} : {content: annotationContent(raw.content)})});
}
function cacheValue(raw: unknown): NativeAnnotationCache {
  if (!object(raw) || raw.complete !== true || !integer(raw.revision) || !Array.isArray(raw.entries) || raw.entries.length > MAX_CACHE_ENTRIES) throw new Error('native_annotation_journal_invalid');
  const entries = raw.entries.map(annotationEntry);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('native_annotation_journal_invalid');
  return Object.freeze({revision: raw.revision, entries: Object.freeze(entries), complete: true});
}
/** A record that belongs to another identity is a refusal, not an absent record. */
function record(raw: unknown, identity: NativeAnnotationIdentity): NativeAnnotationRecord | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'string') {try {raw = JSON.parse(raw);} catch {throw new Error('native_annotation_journal_invalid');}}
  if (!object(raw) || raw.version !== ANNOTATION_JOURNAL_VERSION || !object(raw.identity) || !Array.isArray(raw.groups)
    || typeof raw.identity.serverId !== 'string' || typeof raw.identity.accountId !== 'string' || typeof raw.identity.profileId !== 'string') throw new Error('native_annotation_journal_invalid');
  if (!sameIdentity(raw.identity as NativeAnnotationIdentity, identity)) throw new Error('native_annotation_journal_foreign_profile');
  const groups = raw.groups.map(group => {
    if (!object(group) || !object(group.source) || !Array.isArray(group.operations) || typeof group.source.itemId !== 'string'
      || typeof group.source.sourceId !== 'string' || typeof group.source.sourceRevision !== 'string' || !format(group.source.format)
      || group.localRevision !== undefined && !integer(group.localRevision)) throw new Error('native_annotation_journal_invalid');
    const operations = group.operations.map(operation);
    if (new Set(operations.map(value => value.id)).size !== operations.length) throw new Error('native_annotation_journal_invalid');
    const cache = group.cache === undefined ? {} : {cache: cacheValue(group.cache)};
    return Object.freeze({source: Object.freeze({itemId: group.source.itemId, sourceId: group.source.sourceId,
      sourceRevision: group.source.sourceRevision, format: group.source.format}), operations: Object.freeze(operations),
      localRevision: (group.localRevision as number | undefined) ?? 0, ...cache});
  });
  const total = groups.reduce((sum, group) => sum + group.operations.length, 0);
  if (groups.length > MAX_JOURNAL_GROUPS || total > MAX_JOURNAL_OPERATIONS) throw new Error('native_annotation_journal_invalid');
  return Object.freeze({version: ANNOTATION_JOURNAL_VERSION, identity: Object.freeze({...identity}), groups: Object.freeze(groups)});
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const empty = (identity: NativeAnnotationIdentity): NativeAnnotationRecord => Object.freeze({version: ANNOTATION_JOURNAL_VERSION, identity: Object.freeze({...identity}), groups: Object.freeze([])});
const fit = (record: NativeAnnotationRecord): NativeAnnotationRecord | undefined =>
  record.groups.length > MAX_JOURNAL_GROUPS || bytes(record) > MAX_RECORD_BYTES ? undefined : record;

/** A throwing guard: the caller's `fresh` is a predicate, and returning false must abort. */
const guardOf = (assert?: () => void, signal?: AbortSignal, live?: () => boolean) => () => {
  if (live && !live()) throw new Error(RETIRED);
  if (signal) aborted(signal);
  if (assert) assert();
};

function nativeQueueBackend(identity: NativeAnnotationIdentity, storage: Pick<NativeQueueStore, 'change'>, live: () => boolean): Backend {
  const key = nativeAnnotationJournalKey(identity);
  const change: Change = (update, assert, signal) => {
    const guard = guardOf(assert, signal, live);
    guard();
    return storage.change(key, raw => {
      guard();
      const next = update(record(raw, identity));
      guard(); // The last point before the durable write.
      return {record: next, value: undefined};
    }, undefined, guard);
  };
  return {read: (assert, signal) => {
    const guard = guardOf(assert, signal, live);
    guard();
    let value: NativeAnnotationRecord | undefined;
    return storage.change(key, raw => {guard(); value = record(raw, identity); return {record: raw ?? null, value};}, undefined, guard)
      .then(() => {guard(); return value;});
  }, change};
}

function leaseBackend(state: NativeAnnotationLeaseState, identity: NativeAnnotationIdentity, live: () => boolean): Backend {
  let tail: Promise<unknown> = Promise.resolve();
  const leaseLive = () => {if (!live() || !state.current()) throw new Error(RETIRED);};
  const turn = <T,>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(async () => {leaseLive(); const value = await work(); leaseLive(); return value;});
    tail = run.catch(() => {});
    return run;
  };
  return {
    read: (assert, signal) => turn(async () => {
      guardOf(assert, signal, leaseLive)();
      return record(await state.readState(ANNOTATION_LEASE_STATE), identity);
    }),
    change: (update, assert, signal) => turn(async () => {
      const guard = guardOf(assert, signal, leaseLive);
      guard();
      const current = record(await state.readState(ANNOTATION_LEASE_STATE), identity);
      guard();
      const next = update(current);
      guard(); // The last point before the durable write.
      await state.writeState(ANNOTATION_LEASE_STATE, JSON.stringify(next));
    }),
  };
}

/** One protected record per profile, in whichever store this reader actually has. A bind
 * creates an immutable ticket; operations capture it and can never fall back to another
 * store after `unbind` retires it. */
export class NativeAnnotationJournal {
  private readonly local: Pick<NativeQueueStore, 'change'>;
  private ticket?: Readonly<{identity: NativeAnnotationIdentity; backend: Backend; live: () => boolean}>;
  private life?: {alive: boolean};
  constructor(storage: Pick<NativeQueueStore, 'change'> = new NativeQueueStore()) {this.local = storage;}
  /** Bind before any operation. Migration of the legacy key happens before the ticket
   * becomes visible, and the legacy record is removed only after the new one is durable. */
  bind = async (identity: NativeAnnotationIdentity, lease?: NativeAnnotationLeaseState): Promise<void> => {
    const life = {alive: true};
    if (lease) {
      this.ticket = Object.freeze({identity: Object.freeze({...identity}), backend: leaseBackend(lease, identity, () => life.alive), live: () => life.alive});
    } else {
      await this.migrate(identity);
      this.ticket = Object.freeze({identity: Object.freeze({...identity}), backend: nativeQueueBackend(identity, this.local, () => life.alive), live: () => life.alive});
    }
    this.life = life;
  };
  /** Retire the current ticket synchronously; old operations then fail their own guard and
   * never choose a successor backend. */
  unbind(): void {
    if (this.life) this.life.alive = false;
    this.life = undefined; this.ticket = undefined;
  }
  private store(identity: NativeAnnotationIdentity): Readonly<{backend: Backend; live: () => boolean}> {
    const ticket = this.ticket;
    if (!ticket) throw new Error('native_annotation_journal_unbound');
    if (!sameIdentity(ticket.identity, identity)) throw new Error('native_annotation_journal_foreign_profile');
    if (!ticket.live()) throw new Error(RETIRED);
    return ticket;
  }
  private async migrate(identity: NativeAnnotationIdentity): Promise<void> {
    const legacy = legacyJournalKey(identity), key = nativeAnnotationJournalKey(identity);
    if (legacy === key) return;
    let carried: NativeAnnotationRecord | undefined;
    await this.local.change(legacy, raw => {carried = record(raw, identity); return {record: raw ?? null, value: undefined};});
    if (!carried) return;
    await this.local.change(key, raw => {
      const existing = record(raw, identity);
      if (!existing) return {record: carried!, value: undefined};
      const groups = [...existing.groups];
      for (const group of carried!.groups) {
        const at = groups.findIndex(value => JSON.stringify([value.source.itemId, value.source.sourceId, value.source.sourceRevision, value.source.format])
          === JSON.stringify([group.source.itemId, group.source.sourceId, group.source.sourceRevision, group.source.format]));
        if (at < 0) {groups.push(group); continue;}
        const operations = [...groups[at]!.operations];
        for (const operation of group.operations) if (!operations.some(value => value.id === operation.id)) operations.push(operation);
        groups[at] = {...groups[at]!, operations: Object.freeze(operations), cache: groups[at]!.cache ?? group.cache} as NativeAnnotationGroup;
      }
      return {record: Object.freeze({version: ANNOTATION_JOURNAL_VERSION, identity: Object.freeze({...identity}), groups: Object.freeze(groups)}), value: undefined};
    });
    // Only after the new record is durable does the legacy key go away.
    await this.local.change(legacy, () => ({record: null, value: undefined}));
  }
  snapshot = async (identity: NativeAnnotationIdentity, assert?: () => void, signal?: AbortSignal): Promise<NativeAnnotationRecord | undefined> => {
    const ticket = this.store(identity);
    return ticket.backend.read(assert, signal);
  };
  list = async (identity: NativeAnnotationIdentity, signal?: AbortSignal): Promise<readonly NativeAnnotationGroup[]> =>
    (await this.snapshot(identity, undefined, signal))?.groups ?? [];
  view = async (identity: NativeAnnotationIdentity, source: NativeAnnotationSource, signal?: AbortSignal): Promise<NativeAnnotationView> =>
    nativeAnnotationView(await this.snapshot(identity, undefined, signal), source);

  enqueue = async (identity: NativeAnnotationIdentity, source: NativeAnnotationSource, next: Omit<NativeAnnotationOperation, 'unresolved'>, assert?: () => void, signal?: AbortSignal): Promise<void> => {
    await this.add(identity, source, next, assert, signal, false);
  };
  localMutate = async (identity: NativeAnnotationIdentity, source: NativeAnnotationSource,
    next: Omit<NativeAnnotationOperation, 'unresolved'>, expectedLocalRevision: number, assert?: () => void, signal?: AbortSignal): Promise<number> =>
    this.add(identity, source, next, assert, signal, true, expectedLocalRevision);
  /** Store the whole server set only when it is complete and fits; otherwise leave any
   * existing cache untouched. Never trims a server set into a false complete one. */
  cache = async (identity: NativeAnnotationIdentity, source: NativeAnnotationSource, revision: number, entries: readonly ReadingAnnotation[], signal?: AbortSignal): Promise<void> => {
    if (!integer(revision) || entries.length > MAX_CACHE_ENTRIES || new Set(entries.map(entry => entry.id)).size !== entries.length) return;
    const cache: NativeAnnotationCache = Object.freeze({revision, entries: Object.freeze([...entries]), complete: true});
    if (bytes(cache) > MAX_CACHE_BYTES) return;
    const wanted = JSON.stringify([source.itemId, source.sourceId, source.sourceRevision, source.format]);
    const ticket = this.store(identity);
    await ticket.backend.change((current) => {
      const base = current ?? empty(identity);
      const at = base.groups.findIndex(group => JSON.stringify([group.source.itemId, group.source.sourceId, group.source.sourceRevision, group.source.format]) === wanted);
      if (at < 0) {
        if (base.groups.length >= MAX_JOURNAL_GROUPS) return base; // Refuse only this cache, never a queued group.
        const next = Object.freeze({...base, groups: Object.freeze([...base.groups, Object.freeze({source: Object.freeze({...source}), operations: Object.freeze([]), localRevision: revision, cache})])}) as NativeAnnotationRecord;
        return fit(next) ?? base;
      }
      const groups = [...base.groups];
      const group = groups[at]!;
      groups[at] = Object.freeze({...group, localRevision: Math.max(group.localRevision, revision), cache});
      const next = Object.freeze({...base, groups: Object.freeze(groups)}) as NativeAnnotationRecord;
      return fit(next) ?? base; // Too big: keep the previous record untouched.
    }, undefined, signal);
  };
  resolve = async (identity: NativeAnnotationIdentity, source: NativeAnnotationSource, resolutions: readonly NativeAnnotationResolution[], assert?: () => void, signal?: AbortSignal): Promise<void> => {
    if (!resolutions.length) return;
    const wanted = JSON.stringify([source.itemId, source.sourceId, source.sourceRevision, source.format]);
    const ticket = this.store(identity);
    await ticket.backend.change((current) => {
      if (!current) return empty(identity);
      const groups = current.groups.map(group => {
        if (JSON.stringify([group.source.itemId, group.source.sourceId, group.source.sourceRevision, group.source.format]) !== wanted) return group;
        const operations = group.operations.flatMap(operation => {
          const resolution = resolutions.find(value => value.id === operation.id && value.observedAt === operation.observedAt);
          if (!resolution) return [operation];
          if (resolution.outcome !== 'unresolved') return [];
          return [{...operation, unresolved: resolution.reason} as NativeAnnotationOperation];
        });
        return {...group, operations} as NativeAnnotationGroup;
      }).filter(group => group.operations.length > 0 || group.cache !== undefined);
      return Object.freeze({version: ANNOTATION_JOURNAL_VERSION, identity: Object.freeze({...identity}), groups: Object.freeze(groups)});
    }, assert, signal);
  };
  /** Persist that these operations were actually put on the wire. A transport failure after
   * this leaves the evidence that an absent entry may be a committed-then-deleted create. */
  markAttempted = async (identity: NativeAnnotationIdentity, source: NativeAnnotationSource, ids: readonly string[], assert?: () => void, signal?: AbortSignal): Promise<void> => {
    if (!ids.length) return;
    const wanted = JSON.stringify([source.itemId, source.sourceId, source.sourceRevision, source.format]);
    const ticket = this.store(identity);
    await ticket.backend.change((current) => {
      if (!current) return empty(identity);
      const groups = current.groups.map(group => {
        if (JSON.stringify([group.source.itemId, group.source.sourceId, group.source.sourceRevision, group.source.format]) !== wanted) return group;
        const operations = group.operations.map(operation => ids.includes(operation.id) ? {...operation, attempted: true} as NativeAnnotationOperation : operation);
        return {...group, operations} as NativeAnnotationGroup;
      });
      return Object.freeze({version: ANNOTATION_JOURNAL_VERSION, identity: Object.freeze({...identity}), groups: Object.freeze(groups)});
    }, assert, signal);
  };
  /** The only operation that removes queued private records: an explicit discard. */
  discard = async (identity: NativeAnnotationIdentity, signal?: AbortSignal): Promise<void> => {
    const ticket = this.store(identity);
    await ticket.backend.change(() => empty(identity), undefined, signal); // Explicit erasure of this profile's queued work only.
  };

  private async add(identity: NativeAnnotationIdentity, source: NativeAnnotationSource, next: Omit<NativeAnnotationOperation, 'unresolved'>,
    assert: (() => void) | undefined, signal: AbortSignal | undefined, bump: boolean, expectLocal?: number): Promise<number> {
    if (!integer(next.observedAt) || !integer(next.baseRevision) || !integer(next.baseUpdatedAt)) throw new Error('native_annotation_journal_invalid');
    const operation: NativeAnnotationOperation = next.delete
      ? Object.freeze({id: next.id, delete: true, observedAt: next.observedAt, baseRevision: next.baseRevision, baseUpdatedAt: next.baseUpdatedAt})
      : Object.freeze({id: next.id, delete: false, content: annotationContent(next.content), observedAt: next.observedAt, baseRevision: next.baseRevision, baseUpdatedAt: next.baseUpdatedAt});
    const wanted = JSON.stringify([source.itemId, source.sourceId, source.sourceRevision, source.format]);
    const ticket = this.store(identity);
    let revision = 0;
    await ticket.backend.change((current) => {
      const base = current ?? empty(identity);
      const groups = base.groups.map(group => group);
      const at = groups.findIndex(group => JSON.stringify([group.source.itemId, group.source.sourceId, group.source.sourceRevision, group.source.format]) === wanted);
      const existing = at < 0 ? undefined : groups[at];
      if (expectLocal !== undefined && (existing?.localRevision ?? 0) !== expectLocal) throw new Error('native_annotation_local_conflict');
      const previous = existing?.operations.find(value => value.id === operation.id);
      const merged: NativeAnnotationOperation = previous
        ? Object.freeze({...operation, baseRevision: previous.baseRevision, baseUpdatedAt: previous.baseUpdatedAt,
            ...(previous.attempted === true ? {attempted: true} : {})})
        : operation;
      if (at < 0 && groups.length >= MAX_JOURNAL_GROUPS) {
        const spare = groups.findIndex(value => value.operations.length === 0 && value.cache !== undefined);
        if (spare < 0) throw new Error('native_annotation_journal_full');
        groups.splice(spare, 1); // A cached page, never a person's queued edit.
      }
      const operations = existing ? [...existing.operations.filter(value => value.id !== operation.id), merged] : [merged];
      const localRevision = bump ? (existing?.localRevision ?? 0) + 1 : existing?.localRevision ?? 0;
      revision = localRevision;
      const group: NativeAnnotationGroup = Object.freeze({...existing, source: Object.freeze({...source}),
        operations: Object.freeze(operations.sort((a, b) => a.observedAt - b.observedAt || a.id.localeCompare(b.id))), localRevision});
      if (at < 0) groups.push(group); else groups[at] = group;
      const total = groups.reduce((sum, value) => sum + value.operations.length, 0);
      if (groups.length > MAX_JOURNAL_GROUPS || total > MAX_JOURNAL_OPERATIONS) throw new Error('native_annotation_journal_full');
      let built: NativeAnnotationRecord = Object.freeze({version: ANNOTATION_JOURNAL_VERSION, identity: Object.freeze({...identity}), groups: Object.freeze(groups)});
      // Space belongs to the person's own edits: drop the cached page, never an operation.
      if (bytes(built) > MAX_RECORD_BYTES) {
        const trimmed = groups.map(value => value.cache === undefined ? value : {...value, cache: undefined} as NativeAnnotationGroup);
        built = Object.freeze({version: ANNOTATION_JOURNAL_VERSION, identity: Object.freeze({...identity}), groups: Object.freeze(trimmed)});
      }
      if (bytes(built) > MAX_RECORD_BYTES) throw new Error('native_annotation_journal_full');
      return built;
    }, assert, signal);
    return revision;
  }
}

/** The local view: the complete cached server set overlaid with this device's queued edits.
 * `complete` is false unless the cache is a proven complete set; a partial cache is never
 * presented or exported as the whole collection. */
export function nativeAnnotationView(record: NativeAnnotationRecord | undefined, source: NativeAnnotationSource): NativeAnnotationView {
  const wanted = JSON.stringify([source.itemId, source.sourceId, source.sourceRevision, source.format]);
  const group = record?.groups.find(value => JSON.stringify([value.source.itemId, value.source.sourceId, value.source.sourceRevision, value.source.format]) === wanted);
  const cache = group?.cache;
  const map = new Map<string, ReadingAnnotation>((cache?.entries ?? []).map(entry => [entry.id, entry]));
  for (const op of group?.operations ?? []) {
    if (op.delete) {map.delete(op.id); continue;}
    if (op.content) map.set(op.id, Object.freeze({...op.content, createdAt: op.observedAt, updatedAt: op.observedAt}));
  }
  const entries = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  const complete = cache?.complete === true;
  return Object.freeze({revision: Math.max(group?.localRevision ?? 0, cache?.revision ?? 0), entries: Object.freeze(entries), complete});
}

/** The OfflineCore publication lease a session exposes, when this reader is reading the
 * exact downloaded source. Purely structural: this module never owns the lease or its file. */
export function nativeAnnotationLeaseOf(session: unknown): NativeAnnotationLeaseState | undefined {
  if (!session || typeof session !== 'object' || !('offline' in session)) return undefined;
  const lease = (session as {offline?: unknown}).offline;
  if (!lease || typeof lease !== 'object') return undefined;
  const value = lease as Partial<NativeAnnotationLeaseState>;
  return typeof value.current === 'function' && typeof value.readState === 'function' && typeof value.writeState === 'function'
    ? value as NativeAnnotationLeaseState : undefined;
}

export function nativeAnnotationJournalCounts(groups: readonly NativeAnnotationGroup[]) {
  let queued = 0, unresolved = 0;
  for (const group of groups) for (const operation of group.operations) {queued++; if (operation.unresolved) unresolved++;}
  return {queued, unresolved};
}
