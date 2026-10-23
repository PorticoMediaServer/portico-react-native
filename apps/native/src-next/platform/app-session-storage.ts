import {
  AppSessionStore, parseAppSessionRecord, type AppSessionStorage,
} from '../../../../packages/client-core/src/app-sessions';
import {selectedViewerRecord} from '../../../../packages/client-core/src/viewer-selection';
import {RouteError} from '../../../../packages/client-core/src/route-identity';
import {NativeQueueStore} from './queue-storage';

const listeners = new Set<() => void>();
const damaged = {error: () => new RouteError('invalid_saved_connection', 'Saved app sign-ins are incomplete.')};
export function subscribeNativeAppSessions(listener: () => void) {
  listeners.add(listener); return () => {listeners.delete(listener);};
}
/** The canonical multi-server envelope lives in the existing encrypted native store.
 * NativeQueueStore serializes callback and durable write across every JS owner of this key. */
export const nativeAppSessionStorage: AppSessionStorage = {
  read: () => new NativeQueueStore().change('accounts.sessions.v1', raw => ({
    record: raw, value: raw == null ? undefined : parseAppSessionRecord(raw),
  }), damaged),
  change: async update => {
    await new NativeQueueStore().change('accounts.sessions.v1', raw => {
    const current = raw == null ? undefined : parseAppSessionRecord(raw);
    const next = update(current);
    return {record: next === undefined ? null : parseAppSessionRecord(next), value: undefined};
    }, damaged);
    for (const listener of [...listeners]) listener();
  },
};
export const nativeAppSessions = new AppSessionStore(nativeAppSessionStorage);

/** Selection contains no refresh credential. The canonical connection envelope owns it. */
export async function readNativeSelectedViewer() {
  const selected = await nativeAppSessions.selected();
  return selected ? selectedViewerRecord(selected.connection.logicalOrigin, selected.connection.session, true) : null;
}
