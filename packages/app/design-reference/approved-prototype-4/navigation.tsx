import React, {createContext, useContext, useMemo, useState} from 'react';

export type PrimaryDestination = 'home' | 'library' | 'channels' | 'saved' | 'downloads';

export type PorticoRoute =
  | {name: PrimaryDestination}
  | {name: 'search'}
  | {name: 'settings'}
  | {name: 'sign-in'}
  | {name: 'recovery-gallery'}
  | {name: 'detail'; mediaId: string}
  | {name: 'player'; mediaId: string; live?: boolean};

interface PorticoNavigationValue {
  route: PorticoRoute;
  stack: PorticoRoute[];
  selectPrimary(destination: PrimaryDestination): void;
  openSearch(): void;
  openSettings(): void;
  openSignIn(): void;
  openRecoveryGallery(): void;
  openDetail(mediaId: string): void;
  openPlayer(mediaId: string, live?: boolean): void;
  back(): void;
}

const PorticoNavigationContext = createContext<PorticoNavigationValue | undefined>(undefined);

export function PorticoNavigationProvider({children}: {children: React.ReactNode}) {
  const [stack, setStack] = useState<PorticoRoute[]>([{name: 'home'}]);
  const route = useMemo<PorticoRoute>(() => stack[stack.length - 1] ?? {name: 'home'}, [stack]);

  const value = useMemo<PorticoNavigationValue>(() => ({
    route,
    stack,
    selectPrimary: destination => setStack([{name: destination}]),
    openSearch: () => setStack(current => current[current.length - 1]?.name === 'search' ? current : [...current, {name: 'search'}]),
    openSettings: () => setStack(current => current[current.length - 1]?.name === 'settings' ? current : [...current, {name: 'settings'}]),
    openSignIn: () => setStack(current => current[current.length - 1]?.name === 'sign-in' ? current : [...current, {name: 'sign-in'}]),
    openRecoveryGallery: () => setStack(current => current[current.length - 1]?.name === 'recovery-gallery' ? current : [...current, {name: 'recovery-gallery'}]),
    openDetail: mediaId => setStack(current => [...current, {name: 'detail', mediaId}]),
    openPlayer: (mediaId, live) => setStack(current => [...current, {name: 'player', mediaId, live}]),
    back: () => setStack(current => current.length > 1 ? current.slice(0, -1) : current),
  }), [route, stack]);

  return <PorticoNavigationContext.Provider value={value}>{children}</PorticoNavigationContext.Provider>;
}

export function usePorticoNavigation(): PorticoNavigationValue {
  const context = useContext(PorticoNavigationContext);
  if (!context) {
    throw new Error('usePorticoNavigation must be used within PorticoNavigationProvider.');
  }
  return context;
}
