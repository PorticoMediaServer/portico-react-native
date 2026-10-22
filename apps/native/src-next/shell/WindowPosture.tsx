import React, {createContext, useContext} from 'react';
import {usePlatformPosture, type PlatformPostureSnapshot} from '../platform/platformPosture';

const WindowPostureContext = createContext<PlatformPostureSnapshot | undefined>(undefined);

/** One read-only subscription per shell lifetime. Layout still follows the RN window hook. */
export function WindowPostureProvider({children}: {children: React.ReactNode}) {
  const posture = usePlatformPosture();
  return <WindowPostureContext.Provider value={posture}>{children}</WindowPostureContext.Provider>;
}

export function useWindowPosture(): PlatformPostureSnapshot {
  const posture = useContext(WindowPostureContext);
  if (!posture) throw new Error('A native window posture provider is required.');
  return posture;
}
