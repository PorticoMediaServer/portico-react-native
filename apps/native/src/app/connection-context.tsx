import React, {createContext, useContext, useSyncExternalStore} from 'react';
import type {ConnectionStatus, ConnectionStatusStore} from './connection-status';

export type ConnectionActions = {
  /** Try the remembered server again, or re-probe a lost route. */
  retry: () => void;
  /** Leave for the server chooser ("Use another server or account"). */
  useAnother: () => void;
};

const ConnectionStatusContext = createContext<Readonly<{store: ConnectionStatusStore; actions: ConnectionActions}> | null>(null);

export function ConnectionStatusProvider({store, retry, useAnother, children}: {store: ConnectionStatusStore; retry: () => void; useAnother: () => void; children: React.ReactNode}) {
  const actions = React.useMemo<ConnectionActions>(() => ({retry, useAnother}), [retry, useAnother]);
  const value = React.useMemo(() => ({store, actions}), [store, actions]);
  return <ConnectionStatusContext.Provider value={value}>{children}</ConnectionStatusContext.Provider>;
}

function useConnectionContext() {
  const ctx = useContext(ConnectionStatusContext);
  if (!ctx) throw new Error('ConnectionStatusProvider is missing above this screen.');
  return ctx;
}

/** The current connection status, from the shell's store (`useSyncExternalStore`). */
export function useConnectionStatus(): ConnectionStatus {
  const {store} = useConnectionContext();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** `{retry, useAnother}` for the centered status. */
export function useConnectionActions(): ConnectionActions {
  return useConnectionContext().actions;
}
