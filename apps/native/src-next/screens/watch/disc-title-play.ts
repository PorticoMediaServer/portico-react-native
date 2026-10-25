import type {DiscTitles} from './disc-titles';

/** A chosen title inside one existing physical disc version. It carries only the
 * server's opaque selection id and the revision that binds that title's measured
 * facts: never a playlist number and never a version of the film. */
export type NativeDiscTitleRef = Readonly<{id: string; revision: string}>;
export type NativeDiscTitleSelection = Readonly<{
  itemId: string;
  versionId: string;
  title: NativeDiscTitleRef;
  number: number;
  main: boolean;
  chapterCount: number;
  durationMs: number;
}>;

/** The exact selection a play would name. The row must still be in the document
 * that was read for this version, be analyzed, and carry its own revision: the
 * server publishes no revision for a title whose facts it has not accepted, and
 * such a title has nothing to play yet. The document's own revision never stands
 * in for the row's, because it binds the whole version rather than one title. */
export function nativeDiscTitleSelection(drawn: DiscTitles, itemId: string, titleId: string): NativeDiscTitleSelection | undefined {
  const row = drawn.titles.find(value => value.id === titleId);
  if (!row || !row.ready || !row.revision) return undefined;
  return Object.freeze({itemId, versionId: drawn.versionId, title: Object.freeze({id: row.id, revision: row.revision}),
    number: row.number, main: row.main, chapterCount: row.chapterCount, durationMs: row.durationMs});
}

/** GET /v1/items/{itemId}/playback-options with this selection. The route answers
 * for this title's own streams, chapters and subtitle resources only when the
 * preview names it, and refuses a title with no version. Every track id a start
 * then sends comes from this answer, never from the main title's options. */
export function discTitlePreviewQuery(selection: NativeDiscTitleSelection): Readonly<{versionId: string; discTitleId: string; discTitleRevision: string}> {
  return Object.freeze({versionId: selection.versionId, discTitleId: selection.title.id, discTitleRevision: selection.title.revision});
}

/** The direct start's own fields (POST /v1/playback/sessions): an item and version
 * with the title, and no queue. The server accepts this shape; the native runtime
 * is queue-required and requires a queue entry on the session's fence, so no
 * adapter consumes it until a queue-compatible admission exists. */
export function discTitleStartBody(selection: NativeDiscTitleSelection): Readonly<{itemId: string; versionId: string; discTitle: NativeDiscTitleRef}> {
  return Object.freeze({itemId: selection.itemId, versionId: selection.versionId, discTitle: selection.title});
}
