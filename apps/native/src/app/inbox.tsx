import React, {createContext, useContext, useEffect, useMemo, useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {InboxService, type InboxSnapshot} from '../../../../packages/client-core/src/index';
import {useSession} from './session';
import {viewerKey} from './viewer-scope';
import {useFreshness} from './freshness';
import {dependsOn} from '../../../../packages/client-core/src/freshness-hub';

const InboxContext = createContext<InboxService | null>(null);

/** One inbox per signed-in session, shared by the badge and the inbox screen. The server says on
 * the event feed when the inbox changed: the badge is read again then, and the open list with
 * it (what is on screen stays until the new page arrives). The count is also read when the app
 * returns to the foreground. Nothing is asked on a timer. */
export function InboxProvider({children}: {children: React.ReactNode}) {
  const {api, session} = useSession();
  // One per viewer, not per access token: a renewed sign-in keeps the same inbox.
  const key = viewerKey(session, api);
  const service = useMemo(() => (key && api ? new InboxService(api) : null), [api, key]);
  const {hub} = useFreshness();
  useEffect(() => {
    if (!service) return;
    const refresh = () => { if (AppState.currentState === 'active') void service.refreshUnread(); };
    refresh();
    const changed = () => {
      if (AppState.currentState !== 'active') return;
      void service.refreshUnread();
      if (service.getSnapshot().phase === 'ready') void service.load();
    };
    const off = hub.watch([dependsOn.event('notification.changed')], changed);
    const listener = AppState.addEventListener('change', refresh);
    return () => { off(); listener.remove(); service.dispose(); };
  }, [service, hub]);
  return <InboxContext.Provider value={service}>{children}</InboxContext.Provider>;
}

const idle: InboxSnapshot = Object.freeze<InboxSnapshot>({phase: 'idle', audience: 'profile', audiences: ['profile'], view: 'unread', items: [], counts: {unread: 0, read: 0, archived: 0, total: 0}, unread: 0, revision: 0, more: false, busy: false});
const noSubscribe = () => () => {};
const idleSnapshot = () => idle;

export function useInbox(): {service: InboxService | null; state: InboxSnapshot} {
  const service = useContext(InboxContext);
  const state = useSyncExternalStore(service?.subscribe ?? noSubscribe, service?.getSnapshot ?? idleSnapshot);
  return {service, state};
}

export function useUnreadCount(): number {
  const service = useContext(InboxContext);
  return useSyncExternalStore(service?.subscribe ?? noSubscribe, () => service?.getSnapshot().unread ?? 0);
}
