import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {RepairTarget} from '../../../../packages/client-core/src/metadata-repair';

/** One editor for the whole app; any surface opens it with one or more targets. */
export type EditorRequest = {targets: readonly RepairTarget[]; titles: readonly string[]; onSaved?: () => void};
type Value = {request: EditorRequest | null; open: (request: EditorRequest) => void; close: () => void};
const Ctx = createContext<Value | null>(null);

export function MetadataEditorProvider({children}: {children: React.ReactNode}) {
  const [request, setRequest] = useState<EditorRequest | null>(null);
  const open = useCallback((r: EditorRequest) => setRequest(r.targets.length ? r : null), []);
  const close = useCallback(() => setRequest(null), []);
  const value = useMemo(() => ({request, open, close}), [request, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useMetadataEditor = () => useContext(Ctx);

export function repairTargetFor(entry: Pick<ContentEntry, 'id' | 'kind' | 'libraryId' | 'navigation'>): RepairTarget | null {
  if (!entry.libraryId) return null;
  const id = entry.navigation?.entityId ?? entry.id;
  switch (entry.kind) {
    case 'movie': case 'episode': case 'song': case 'audiobook_file': return {kind: 'item', id: entry.id, libraryId: entry.libraryId};
    case 'show': return {kind: 'show', id, libraryId: entry.libraryId};
    case 'season': return {kind: 'season', id, libraryId: entry.libraryId};
    case 'album': return {kind: 'album', id, libraryId: entry.libraryId};
    case 'artist': return {kind: 'artist', id, libraryId: entry.libraryId};
    case 'book': return {kind: 'book', id, libraryId: entry.libraryId};
    default: return null;
  }
}
