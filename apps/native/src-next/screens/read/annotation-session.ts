import {ReadingError, type ReadingHostSession, type ReadingSession} from '../../../../../packages/client-core/src';
import type {ReadingAnnotationContent, ReadingAnnotationMutation, ReadingAnnotationPort} from '../../../../../packages/client-core/src/reading-annotations';
import type {NativeAnnotationJournal, NativeAnnotationIdentity, NativeAnnotationSource} from './annotation-journal';

/** The existing annotation bridge with one addition: a transport failure queues the
 * person's original edit in the private journal instead of losing it. The guest still
 * receives the real failure (nothing is reported as saved while it is only queued); the
 * reconnect merge uploads the frozen payload under the same annotation id. */

/** Failures worth keeping: transport, offline and server-unavailable. A refusal the server
 * itself explained (invalid, forbidden, conflict, changed source) is never queued. */
export function nativeAnnotationQueueable(error: unknown): boolean {
  if (!(error instanceof ReadingError)) return true; // fetch/offline rejection
  if (error.code === 'cancelled') return false;
  return error.status === undefined || error.status >= 500;
}

const content = (mutation: Extract<ReadingAnnotationMutation, {operation: 'upsert'}>): ReadingAnnotationContent => {
  const {expectedRevision: _revision, operation: _operation, ...rest} = mutation;
  return rest;
};

export function nativeAnnotationSession(options: Readonly<{
  session: ReadingSession;
  journal: NativeAnnotationJournal;
  identity: NativeAnnotationIdentity;
  source: NativeAnnotationSource;
  /** The captured authority/session fence; the journal write is refused once it ends. */
  fresh: () => boolean;
  now?: () => number;
  onQueued?: () => void;
}>): ReadingHostSession {
  const {session, journal, identity, source, fresh, now = Date.now, onQueued} = options;
  // The bridge projection is always the real session; only the annotation methods differ.
  const base: ReadingHostSession = {manifest: session.manifest, signal: session.signal, headPDF: session.headPDF, readRange: session.readRange,
    readAsset: session.readAsset, page: session.page, progress: session.progress, saveProgress: session.saveProgress,
    ...(session.openSequential ? {openSequential: session.openSequential} : {})};
  if (session.manifest.canAnnotate !== true) return base;
  /** The server's own updatedAt for each id at the revision the guest last read. */
  let observed: Readonly<{revision: number; updatedAt: ReadonlyMap<string, number>}> | undefined;
  const annotations: ReadingAnnotationPort['annotations'] = async (cursor = '', revision?: number, signal?: AbortSignal) => {
    const page = await session.annotations(cursor, revision, signal);
    if (!cursor) observed = {revision: page.revision, updatedAt: new Map(page.entries.map(entry => [entry.id, entry.updatedAt]))};
    else if (observed && observed.revision === page.revision) {
      const updatedAt = new Map(observed.updatedAt);
      for (const entry of page.entries) updatedAt.set(entry.id, entry.updatedAt);
      observed = {revision: page.revision, updatedAt};
    }
    return page;
  };
  const mutateAnnotation: ReadingAnnotationPort['mutateAnnotation'] = async (mutation, signal) => {
    try {
      const saved = await session.mutateAnnotation(mutation, signal);
      // The server now holds a newer entry than the guest's cached page; a later queued
      // edit must not claim that stale base, so the next write waits for a fresh read.
      observed = undefined;
      return saved;
    } catch (error) {
      const base = observed;
      if (!nativeAnnotationQueueable(error) || !base || base.revision !== mutation.expectedRevision || !fresh()) throw error;
      await journal.enqueue(identity, source, {
        id: mutation.id,
        delete: mutation.operation === 'delete',
        ...(mutation.operation === 'delete' ? {} : {content: content(mutation)}),
        observedAt: now(),
        baseRevision: mutation.expectedRevision,
        baseUpdatedAt: base.updatedAt.get(mutation.id) ?? 0,
      }, fresh);
      onQueued?.();
      throw error;
    }
  };
  return {...base, annotations, mutateAnnotation};
}
