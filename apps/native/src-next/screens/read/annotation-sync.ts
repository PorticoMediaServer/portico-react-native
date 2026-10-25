import {ReadingError, type LocalSession, type ReadingClient, type ReadingSession} from '../../../../../packages/client-core/src';
import type {ReadingAnnotation} from '../../../../../packages/client-core/src/reading-annotations';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {
  NativeAnnotationJournal, nativeAnnotationFingerprint, nativeAnnotationJournalCounts, nativeAnnotationIdentity,
  type NativeAnnotationGroup, type NativeAnnotationIdentity, type NativeAnnotationOperation, type NativeAnnotationResolution,
  type NativeAnnotationUnresolved,
} from './annotation-journal';

/** The reconnect merge for the private offline annotation journal.
 *
 * Review findings #1, #3, #4 and #7's merge half are addressed here: every pass is bound to
 * the committed reader's own life and activity, the deadline and reader life are joined into
 * the actual transport signal, a stop aborts that transport synchronously and a later replay
 * starts a fresh committed pass, and absence is no longer treated as evidence of a fresh
 * create after the server set has advanced. The payload and its id never change; the only CAS
 * token is the revision read for that attempt. */

export type NativeAnnotationSyncState = Readonly<{
  phase: 'idle' | 'syncing' | 'error';
  queued: number;
  unresolved: number;
  error?: unknown;
}>;
type Identity = Readonly<{sessionFamilyId: string; viewer: LocalSession['viewer']; authority: ShellAuthority}>;
type Life = AbortController;

const PAGE_LIMIT = 6, SET_LIMIT = 256, GROUP_DEADLINE_MS = 20_000;
const semantic = new Set(['invalid_document', 'invalid_response', 'invalid_revision', 'invalid_location', 'not_permitted', 'conflict', 'cancelled', 'response_size', 'source_changed']);
const cancelled = (error: unknown, signal?: AbortSignal): boolean => signal?.aborted === true
  || (error instanceof Error && (error.name === 'AbortError' || error.code === 'ABORT_ERR'))
  || (error instanceof ReadingError && error.code === 'cancelled');
const retryable = (error: unknown): boolean => !(error instanceof ReadingError) || error.status === undefined && !semantic.has(error.code);
const displaced = (error: unknown): boolean => error instanceof ReadingError && (error.code === 'conflict' || error.code === 'source_changed');
type Decision = Readonly<{kind: 'apply'}> | Readonly<{kind: 'resolved'}> | Readonly<{kind: 'unresolved'; reason: NativeAnnotationUnresolved}>;
type PageState = Readonly<{revision: number; entries: readonly ReadingAnnotation[]}>;

function sameAnnotation(entry: ReadingAnnotation, content: NativeAnnotationOperation['content']): boolean {
  if (!content || entry.kind !== content.kind || entry.text !== content.text || entry.note !== content.note || entry.colour !== content.colour) return false;
  if (entry.location.format !== content.location.format || entry.location.progression !== content.location.progression
    || (entry.location.format === 'epub' ? entry.location.cfi !== content.location.cfi || entry.location.section !== content.location.section
      : entry.location.pageIndex !== content.location.pageIndex)) return false;
  const rects = entry.rects ?? [], wanted = content.rects ?? [];
  return rects.length === wanted.length && rects.every((rect, index) => rect.x === wanted[index]!.x && rect.y === wanted[index]!.y
    && rect.width === wanted[index]!.width && rect.height === wanted[index]!.height);
}

/** Union by id, last edit wins, proven by content identity and the captured base:
 * - a present entry applies only when its fingerprint still equals the captured base (or no
 *   set write happened since the base); a timestamp inequality is never used as identity;
 * - an absent create applies only when it was never put on the wire with a complete base, or
 *   when the set did not advance after an attempt (an accepted-then-deleted create is not
 *   distinguishable then, so it stays unresolved);
 * - an absent update is a deletion elsewhere and stays unresolved;
 * - a delete is satisfied by absence and otherwise needs the captured base fingerprint. */
export function nativeAnnotationDecision(state: PageState, operation: NativeAnnotationOperation): Decision {
  const entry = state.entries.find(value => value.id === operation.id);
  const current = entry ? nativeAnnotationFingerprint(entry) : undefined;
  if (operation.delete) {
    if (!entry) return {kind: 'resolved'};
    if (operation.baseFingerprint !== undefined) return current === operation.baseFingerprint ? {kind: 'apply'} : {kind: 'unresolved', reason: 'server-newer'};
    return state.revision === operation.baseRevision ? {kind: 'apply'} : {kind: 'unresolved', reason: 'conflict'};
  }
  if (!operation.content) return {kind: 'resolved'};
  const wanted = nativeAnnotationFingerprint(operation.content);
  if (state.revision < operation.baseRevision) return {kind: 'unresolved', reason: 'conflict'};
  if (!entry) {
    if (operation.baseUpdatedAt > 0) return {kind: 'unresolved', reason: 'deleted-elsewhere'};
    if (operation.attempted === true) {
      // The set did not advance after the attempt, so the server never accepted it.
      return state.revision === operation.baseRevision ? {kind: 'apply'} : {kind: 'unresolved', reason: 'deleted-elsewhere'};
    }
    // Never sent: a client id cannot exist elsewhere, and with an unchanged set the absence
    // is the base we captured. A complete base makes that true at any later revision.
    if (operation.baseComplete === true) return {kind: 'apply'};
    return state.revision === operation.baseRevision ? {kind: 'apply'} : {kind: 'unresolved', reason: 'deleted-elsewhere'};
  }
  if (current === wanted) return {kind: 'resolved'}; // our own committed retry
  if (operation.baseFingerprint !== undefined) return current === operation.baseFingerprint ? {kind: 'apply'} : {kind: 'unresolved', reason: 'server-newer'};
  return state.revision === operation.baseRevision ? {kind: 'apply'} : {kind: 'unresolved', reason: 'server-newer'};
}

export class NativeAnnotationSync {
  private readonly context: NativeShellBootstrapContext;
  private readonly journal: NativeAnnotationJournal;
  private readonly active: () => boolean;
  private readonly listeners = new Set<() => void>();
  private state: NativeAnnotationSyncState = Object.freeze({phase: 'idle', queued: 0, unresolved: 0});
  private life: Life = new AbortController();
  private running?: Promise<void>;
  constructor(context: NativeShellBootstrapContext, journal = new NativeAnnotationJournal(), active: () => boolean = () => true) {
    this.context = context; this.journal = journal; this.active = active;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => {this.listeners.delete(listener);};
  };
  private publish(next: NativeAnnotationSyncState, life: Life) {
    if (this.life !== life || life.signal.aborted) return;
    this.state = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }
  private capture(): Identity | undefined {
    const session = this.context.session();
    if (!session || !this.context.current()) return undefined;
    return Object.freeze({sessionFamilyId: session.sessionFamilyId, viewer: Object.freeze({...session.viewer}), authority: this.context.authority()});
  }
  /** Fresh authorization for this exact profile, session family and active reader. */
  private fresh(identity: Identity, life: Life): boolean {
    if (life.signal.aborted || !this.active()) return false;
    const live = this.context.session();
    return this.context.current() && !!live
      && live.sessionFamilyId === identity.sessionFamilyId && sameAuthority(identity.authority, this.context.authority())
      && live.viewer.authority === identity.viewer.authority && live.viewer.serverId === identity.viewer.serverId
      && live.viewer.accountId === identity.viewer.accountId && live.viewer.profileId === identity.viewer.profileId;
  }
  /** Read the whole bounded set, or fail: a page budget exhaustion is never treated as a
   * complete set, and every page must share one revision with unique ids. */
  private async pages(session: ReadingSession, signal: AbortSignal): Promise<PageState> {
    let cursor = '', revision: number | undefined, entries: ReadingAnnotation[] = [], exhausted = false;
    const ids = new Set<string>();
    for (let page = 0; page < PAGE_LIMIT; page++) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new ReadingError('cancelled');
      const out = await session.annotations(cursor, cursor ? revision : undefined, signal);
      if (revision !== undefined && out.revision !== revision) throw new ReadingError('invalid_document');
      revision = out.revision;
      for (const entry of out.entries) {
        if (ids.has(entry.id)) throw new ReadingError('invalid_document');
        ids.add(entry.id); entries.push(entry);
      }
      if (entries.length > SET_LIMIT) throw new ReadingError('invalid_document');
      if (!out.nextCursor) {exhausted = true; break;}
      cursor = out.nextCursor;
    }
    if (!exhausted) throw new ReadingError('invalid_document'); // Never present a page-budget subset as complete.
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new ReadingError('cancelled');
    return {revision: revision ?? 0, entries};
  }
  /** The group is bound to the committed reader's life and activity for its whole transport. */
  private async syncGroup(identity: Identity, group: NativeAnnotationGroup, life: Life, live?: NativeAnnotationLivePort): Promise<boolean> {
    const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(new ReadingError('cancelled')), GROUP_DEADLINE_MS);
    const control = new AbortController();
    const stop = () => {if (!control.signal.aborted) control.abort(life.signal.reason ?? deadline.signal.reason ?? new ReadingError('cancelled'));};
    const offLife = () => life.signal.addEventListener('abort', stop, {once: true}), offDeadline = () => deadline.signal.addEventListener('abort', stop, {once: true});
    offLife(); offDeadline();
    if (life.signal.aborted || deadline.signal.aborted) stop();
    const signal = control.signal;
    let client: ReadingClient | undefined, session: NativeAnnotationLivePort | undefined, owned: ReadingSession | undefined;
    const reuse = !!live && !live.signal.aborted && live.manifest.canAnnotate === true
      && typeof live.annotations === 'function' && typeof live.mutateAnnotation === 'function'
      && live.manifest.sourceId === group.source.sourceId && live.manifest.revision === group.source.sourceRevision;
    const mark = async (reason: NativeAnnotationUnresolved) => {
      const resolutions: NativeAnnotationResolution[] = group.operations.map(operation => ({id: operation.id, observedAt: operation.observedAt, outcome: 'unresolved', reason}));
      if (this.fresh(identity, life)) await this.journal.resolve(identity, group.source, resolutions, () => {if (!this.fresh(identity, life)) throw new ReadingError('cancelled');}, signal);
    };
    try {
      if (reuse) session = live;
      else {
        client = this.context.api.reading({viewer: identity.viewer, isCurrent: () => this.fresh(identity, life), signal});
        const versions = await client.versions(group.source.itemId, signal);
        if (!this.fresh(identity, life)) return true;
        if (!versions.versions.some(value => value.sourceId === group.source.sourceId)) {await mark('stale-source'); return false;}
        session = owned = await client.open({itemId: group.source.itemId, sourceId: group.source.sourceId}, signal);
      }
      const manifest = session.manifest;
      if (manifest.itemId !== group.source.itemId || manifest.sourceId !== group.source.sourceId) {await mark('source-changed'); return false;}
      if (manifest.revision !== group.source.sourceRevision) {await mark('source-changed'); return false;}
      if (manifest.canAnnotate !== true) {await mark('refused'); return false;}
      let state = await this.pages(session, signal);
      // Cache only the whole set; the journal stores it only when it fits without trimming.
      await this.journal.cache(identity, group.source, state.revision, state.entries, signal).catch(() => {});
      for (const operation of group.operations) {
        if (!this.fresh(identity, life) || signal.aborted) return true;
        const settled = (outcome: NativeAnnotationResolution) =>
          this.journal.resolve(identity, group.source, [outcome],
            () => {if (!this.fresh(identity, life)) throw new ReadingError('cancelled');}, signal);
        const decision = nativeAnnotationDecision(state, operation);
        if (decision.kind !== 'apply') {
          await settled({id: operation.id, observedAt: operation.observedAt, ...decision});
          continue;
        }
        const build = (revision: number) => operation.delete
          ? {operation: 'delete' as const, id: operation.id, expectedRevision: revision}
          : {...operation.content!, operation: 'upsert' as const, expectedRevision: revision};
        const witness = () => this.journal.markAttempted(identity, group.source, [{id: operation.id, observedAt: operation.observedAt}],
          () => {if (!this.fresh(identity, life)) throw new ReadingError('cancelled');}, signal);
        try {
          if (!this.fresh(identity, life) || signal.aborted) return true; // Re-check after the page/cache awaits.
          await witness(); // Durable evidence before any wire write.
          if (!this.fresh(identity, life) || signal.aborted) return true;
          const saved = await session.mutateAnnotation(build(state.revision), signal);
          if (saved.revision !== state.revision + 1) throw new ReadingError('invalid_document');
          await settled({id: operation.id, observedAt: operation.observedAt, outcome: 'applied'});
        } catch (error) {
          if (cancelled(error, signal) || !this.fresh(identity, life)) return true;
          if (!displaced(error)) {
            if (retryable(error)) throw error;
            await settled({id: operation.id, observedAt: operation.observedAt, outcome: 'unresolved', reason: 'refused'});
            continue;
          }
          // One fresh read may explain the displacement; the payload is unchanged.
          state = await this.pages(session, signal);
          const again = nativeAnnotationDecision(state, operation);
          if (again.kind !== 'apply') {await settled({id: operation.id, observedAt: operation.observedAt, ...again}); continue;}
          if (!this.fresh(identity, life) || signal.aborted) return true;
          try {
            await witness();
            const saved = await session.mutateAnnotation(build(state.revision), signal);
            if (saved.revision !== state.revision + 1) throw new ReadingError('invalid_document');
            await settled({id: operation.id, observedAt: operation.observedAt, outcome: 'applied'});
          } catch (second) {
            if (cancelled(second, signal) || !this.fresh(identity, life)) return true;
            if (retryable(second)) throw second;
            await settled({id: operation.id, observedAt: operation.observedAt, outcome: 'unresolved',
              reason: displaced(second) ? 'conflict' : 'refused'});
            continue;
          }
        }
        // The operation is settled; a failed refresh stops the pass (remaining ops stay queued)
        // but never un-settles a mutation the server already accepted.
        try {
          state = await this.pages(session, signal);
          await this.journal.cache(identity, group.source, state.revision, state.entries, signal).catch(() => {});
        } catch {return true;}
      }
    } catch (error) {
      if (this.fresh(identity, life) && !signal.aborted && error instanceof ReadingError && error.code === 'not_permitted') {
        await mark('refused'); return false;
      }
      if (this.fresh(identity, life) && !signal.aborted) this.publish({...this.state, phase: 'error', error}, life);
      return !signal.aborted && this.fresh(identity, life);
    } finally {
      clearTimeout(timer);
      life.signal.removeEventListener('abort', stop);
      deadline.signal.removeEventListener('abort', stop);
      if (owned && !signal.aborted) await owned.close().catch(() => {});
      client?.dispose();
    }
    return false;
  }
  /** Retry every queued source for the current profile. Never reports success for a queued op. */
  flush = (live?: NativeAnnotationLivePort): Promise<void> => {
    if (this.life.signal.aborted) this.life = new AbortController(); // A committed replay starts its own life.
    const life = this.life;
    if (this.running) return this.running;
    const identity = this.capture();
    if (!identity || !this.active()) return Promise.resolve();
    const run = (async () => {
      this.publish({...this.state, phase: 'syncing'}, life);
      try {
        const groups = await this.journal.list(nativeAnnotationIdentity(identity.viewer), life.signal);
        for (const group of groups) {
          if (!this.fresh(identity, life)) break;
          if (await this.syncGroup(identity, group, life, live)) break;
        }
        if (!this.fresh(identity, life)) {this.publish({phase: 'idle', queued: 0, unresolved: 0}, life); return;}
        const remaining = await this.journal.list(nativeAnnotationIdentity(identity.viewer), life.signal);
        this.publish({phase: 'idle', ...nativeAnnotationJournalCounts(remaining)}, life);
      } catch (error) {
        // Never read the journal again after retirement without the same life/ticket: keep the
        // last honest counts when that read cannot be proven current.
        const groups = await this.journal.list(nativeAnnotationIdentity(identity.viewer), life.signal).catch(() => undefined);
        this.publish({phase: 'error', ...(groups ? nativeAnnotationJournalCounts(groups)
          : {queued: this.state.queued, unresolved: this.state.unresolved}), ...(error ? {error} : {})}, life);
      }
    })().finally(() => {if (this.running === run) this.running = undefined;});
    this.running = run;
    return run;
  };
  /** Synchronous retirement: aborts the transport the current pass is actually using and lets
   * a later committed replay start again with a new life. Queued records are untouched. */
  stop(): void {
    if (!this.life.signal.aborted) this.life.abort(new ReadingError('cancelled'));
    this.running = undefined;
  }
  dispose(): void {this.stop(); this.listeners.clear();}
}

/** The already-open reader's own annotation port, reused only for a merge when it is the same
 * source/revision and is a real server port. */
export type NativeAnnotationLivePort = Pick<ReadingSession, 'manifest' | 'signal' | 'annotations' | 'mutateAnnotation'>;
