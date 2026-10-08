import React, {createContext, useContext, useEffect, useMemo, useSyncExternalStore} from 'react';
import {AppState} from 'react-native';
import {InboxService, type InboxSnapshot} from '../../../../packages/client-core/src/index';
import {useSession} from './session';

const InboxContext = createContext<InboxService | null>(null);

/** One inbox per signed-in session, shared by the badge and the inbox screen. The unread count
 * refreshes when the app returns to the foreground and once a minute while it is there. */
export function InboxProvider({children}: {children: React.ReactNode}) {
  const {api, session} = useSession();
  const key = session?.accessToken ?? '';
  const service = useMemo(() => (key && api ? new InboxService(api) : null), [api, key]);
  useEffect(() => {
    if (!service) return;
    const refresh = () => { if (AppState.currentState === 'active') void service.refreshUnread(); };
    refresh();
    const timer = setInterval(refresh, 60000);
    const listener = AppState.addEventListener('change', refresh);
    return () => { clearInterval(timer); listener.remove(); service.dispose(); };
  }, [service]);
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
