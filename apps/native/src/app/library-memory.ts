import {useMemo, useSyncExternalStore} from 'react';
import {LibraryMemory, type LibraryMemoryStorage} from '../../../../packages/client-core/src/library-memory';
import {NativeQueueStore} from '../bridge/queue-storage';
import {useSession} from './session';
import {viewerScope} from './viewer-scope';

const store = new NativeQueueStore();

/**
 * The device's own record store as the place remembered library choices are kept. The record is
 * the choices themselves (not text inside text), and it never leaves the device. A store that
 * cannot be read or written only means the choices last for this run.
 */
export const deviceLibraryStorage: LibraryMemoryStorage = {
  read: key => store.change<string | null>(key, raw => ({record: raw, value: raw == null ? null : JSON.stringify(raw)})),
  write: (key, text) => store.change<void>(key, () => ({record: JSON.parse(text) as unknown, value: undefined})),
  remove: key => store.change<void>(key, () => ({record: null, value: undefined})),
};

/** One memory per profile and server for the run: it is read from the device once, the first time it is wanted. */
const memories = new Map<string, LibraryMemory>();
const LIMIT = 4;

export function libraryMemoryFor(scope: {viewerId: string; serverId: string}, storage: LibraryMemoryStorage = deviceLibraryStorage): LibraryMemory {
  const key = scope.viewerId + '\n' + scope.serverId;
  let memory = memories.get(key);
  if (!memory) {
    if (memories.size >= LIMIT) { const oldest = memories.keys().next().value as string; memories.get(oldest)?.dispose(); memories.delete(oldest); }
    memory = new LibraryMemory(storage, scope);
    memories.set(key, memory);
  }
  return memory;
}

/**
 * The signed-in profile's remembered library choices on this device (the tab, sort and filters
 * each library was last left on), and whether they have been read yet. Another profile on the
 * same device has its own. The shell asks for it as soon as someone is signed in, so it has been
 * read long before a library is opened.
 */
export function useLibraryMemory(): {memory: LibraryMemory; ready: boolean} {
  const {session, api} = useSession();
  const scope = viewerScope(session, api);
  const memory = useMemo(() => libraryMemoryFor(scope), [scope]);
  const ready = useSyncExternalStore(memory.subscribe.bind(memory), () => memory.isReady);
  return useMemo(() => ({memory, ready}), [memory, ready]);
}
