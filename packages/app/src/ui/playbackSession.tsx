import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {useViewerRuntime} from '@portico-react-native/infrastructure';
import {
  createPlayerSessionController,
  type PlayerMediaFamily,
  type PlayerPresentation,
  type PlayerSessionCommands,
  type PlayerSessionController,
} from '@portico-react-native/player';

export type PersistentPlaybackSnapshot = {
  active: boolean;
  artwork?: string;
  canNext?: boolean;
  canPrevious?: boolean;
  canSeek?: boolean;
  isPlaying: boolean;
  mediaFamily?: PlayerMediaFamily;
  mediaId: string;
  platform?: 'mobile' | 'tv';
  presentation?: PlayerPresentation;
  title: string;
  subtitle?: string;
};

type PersistentPlaybackController = {
  pause(): void;
  play(): void;
};

type PersistentPlaybackValue = {
  controller: PersistentPlaybackController | undefined;
  publish(snapshot: PersistentPlaybackSnapshot | undefined): void;
  register(controller: PersistentPlaybackController & Partial<PlayerSessionCommands>): () => void;
  session: PlayerSessionController;
  snapshot: PersistentPlaybackSnapshot | undefined;
};

const PersistentPlaybackContext = createContext<PersistentPlaybackValue | undefined>(undefined);

export function PersistentPlaybackProvider({children}: {children: React.ReactNode}) {
  const viewerRuntime = useViewerRuntime();
  const sessionRef = useRef<PlayerSessionController | undefined>(undefined);
  if (!sessionRef.current) sessionRef.current = createPlayerSessionController();
  const session = sessionRef.current;
  const snapshotValue = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const snapshot = snapshotValue.active ? snapshotValue : undefined;
  const controller = useMemo<PersistentPlaybackController>(() => ({pause: () => session.pause(), play: () => session.play()}), [session]);
  useEffect(() => {
    viewerRuntime.setPlaybackContinuityActive(Boolean(snapshot));
    return () => viewerRuntime.setPlaybackContinuityActive(false);
  }, [snapshot, viewerRuntime]);
  const register = useCallback((next: PersistentPlaybackController & Partial<PlayerSessionCommands>) =>
    session.registerCommands({
      next: next.next ?? (() => undefined),
      pause: next.pause,
      play: next.play,
      previous: next.previous ?? (() => undefined),
      seekBy: next.seekBy ?? (() => undefined),
      stop: next.stop ?? next.pause,
    }), [session]);
  const publish = useCallback((next: PersistentPlaybackSnapshot | undefined) => {
    const current = session.getSnapshot();
    session.publish(next ? {
      ...next,
      mediaFamily: next.mediaFamily ?? 'video',
      platform: next.platform ?? 'mobile',
      presentation:
        current.active && current.mediaId === next.mediaId
          ? current.presentation
          : next.presentation ?? 'fullscreen',
    } : undefined);
  }, [session]);
  const value = useMemo<PersistentPlaybackValue>(() => ({
    controller,
    publish,
    register,
    session,
    snapshot,
  }), [controller, publish, register, session, snapshot]);
  return <PersistentPlaybackContext.Provider value={value}>{children}</PersistentPlaybackContext.Provider>;
}

export function usePersistentPlayback(): PersistentPlaybackValue {
  const value = useContext(PersistentPlaybackContext);
  if (!value) throw new Error('usePersistentPlayback must be used within PersistentPlaybackProvider.');
  return value;
}
