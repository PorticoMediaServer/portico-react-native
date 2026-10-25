import {ReadingError, type ReadingHostSession} from '../../../../../packages/client-core/src';
import {captureReadingAnnotationMutation, type ReadingAnnotationContent, type ReadingAnnotationMutation, type ReadingAnnotationPort} from '../../../../../packages/client-core/src/reading-annotations';
import {validateReadingLocation} from '../../../../../packages/client-core/src/reading';
import {nativeAnnotationFingerprint, type NativeAnnotationJournal, type NativeAnnotationIdentity, type NativeAnnotationSource} from './annotation-journal';

/** Offline annotation authoring for one downloaded publication (P1-READ-OFFLINE-ANNOTATION-SYNC).
 *
 * HOLD — only offered through `nativeAnnotationBridge` while the containment gate is on after
 * review. This port never claims a larger set than it can prove: the local view is served only
 * when the cached server page is a complete set (`complete: true`); a partial or absent cache
 * fails instead of presenting/exporting a bounded subset as the whole collection.
 *
 * Review finding #1: every await is bracketed by the caller's signal and the committed
 * session/lease guard, and the guard throws (a boolean cannot be ignored). Finding #7: no
 * subset is ever called complete. */

const OFFLINE_INCOMPLETE = 'offline_annotations_incomplete';
const content = (mutation: Extract<ReadingAnnotationMutation, {operation: 'upsert'}>): ReadingAnnotationContent => {
  const {expectedRevision: _revision, operation: _operation, ...rest} = mutation;
  return rest;
};

export function nativeOfflineAnnotationSession(options: Readonly<{
  session: ReadingHostSession;
  journal: NativeAnnotationJournal;
  identity: NativeAnnotationIdentity;
  source: NativeAnnotationSource;
  /** The captured authority/session/lease fence; throws are refusals, not booleans. */
  fresh: () => boolean;
  now?: () => number;
  onQueued?: () => void;
}>): ReadingHostSession {
  const {session, journal, identity, source, fresh, now = Date.now, onQueued} = options;
  const guard = () => {if (!fresh()) throw new ReadingError('cancelled');};
  const check = (signal?: AbortSignal) => {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new ReadingError('cancelled');
    guard();
  };
  const manifest = Object.freeze({...session.manifest, canAnnotate: true as const});
  const validate = (location: Parameters<typeof validateReadingLocation>[0]) => validateReadingLocation(location, manifest);
  const annotations: ReadingAnnotationPort['annotations'] = async (cursor = '', revision?: number, signal?: AbortSignal) => {
    check(signal);
    const view = await journal.view(identity, source, signal);
    check(signal);
    if (!view.complete) throw new ReadingError(OFFLINE_INCOMPLETE); // Never a false complete set.
    if (view.entries.length > 256) throw new ReadingError('invalid_document');
    const remaining = view.entries.filter(entry => entry.id > cursor).slice(0, 50);
    const more = remaining.length === 50 && view.entries.some(entry => entry.id > remaining[remaining.length - 1]!.id);
    if (revision !== undefined && revision !== view.revision) throw new ReadingError('conflict');
    return Object.freeze({sourceId: source.sourceId, sourceRevision: source.sourceRevision, revision: view.revision,
      entries: Object.freeze(remaining), nextCursor: more ? remaining[remaining.length - 1]!.id : ''});
  };
  const mutateAnnotation: ReadingAnnotationPort['mutateAnnotation'] = async (request, signal) => {
    check(signal);
    const captured = captureReadingAnnotationMutation(request, validate);
    const view = await journal.view(identity, source, signal);
    check(signal);
    if (!view.complete) throw new ReadingError(OFFLINE_INCOMPLETE);
    if (captured.expectedRevision !== view.revision) throw new ReadingError('conflict');
    const observed = await journal.snapshot(identity, guard, signal);
    check(signal);
    const group = observed?.groups.find(value => value.source.itemId === source.itemId && value.source.sourceId === source.sourceId
      && value.source.sourceRevision === source.sourceRevision);
    const cached = group?.cache?.entries.find(entry => entry.id === captured.id);
    const revision = await journal.localMutate(identity, source, {
      id: captured.id,
      delete: captured.operation === 'delete',
      ...(captured.operation === 'delete' ? {} : {content: content(captured)}),
      observedAt: now(),
      // The captured server base: its revision, the exact entry identity (not a timestamp) and
      // that the cache was the whole set, so an absent id is evidence and an unchanged one is
      // proven by content. 0 means it exists only locally and was never put on the wire.
      baseRevision: group?.cache?.revision ?? 0,
      baseUpdatedAt: cached ? 1 : 0,
      ...(cached ? {baseFingerprint: nativeAnnotationFingerprint(cached)} : {}),
      baseComplete: group?.cache?.complete === true,
    }, captured.expectedRevision, guard, signal);
    if (signal?.aborted || !fresh()) throw new ReadingError('cancelled'); // Queued privately, never reported as saved.
    onQueued?.();
    return Object.freeze({revision});
  };
  return {manifest, signal: session.signal, headPDF: session.headPDF, readRange: session.readRange, readAsset: session.readAsset,
    page: session.page, progress: session.progress, saveProgress: session.saveProgress,
    ...(session.openSequential ? {openSequential: session.openSequential} : {}), annotations, mutateAnnotation};
}
