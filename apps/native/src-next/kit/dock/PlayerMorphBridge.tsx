import React, {createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode} from 'react';
import {sameFence, type PlaybackFence} from '../../../../../packages/player-core/src';
import type {PlayerMorphController} from './types';

type Binding = Readonly<{controller: PlayerMorphController; fence: PlaybackFence}>;
type Publish = (controller: PlayerMorphController, fence: PlaybackFence) => () => void;
const Published = createContext<Binding | undefined>(undefined);
const Publication = createContext<Publish | undefined>(undefined);

/** Pure presentation wiring, scoped by the shell's original authority key.
 * The persistent player alone publishes; no route owns playback or a second player. */
export function PlayerMorphProvider({children}: {children: ReactNode}) {
  const [binding, setBinding] = useState<Binding>();
  const publish = useCallback<Publish>((controller, fence) => {
    const entry = {controller, fence};
    setBinding(entry);
    return () => setBinding(current => current === entry ? undefined : current);
  }, []);
  return <Publication.Provider value={publish}><Published.Provider value={binding}>{children}</Published.Provider></Publication.Provider>;
}

export function usePlayerMorphPublication(controller: PlayerMorphController, fence: PlaybackFence | undefined) {
  const publish = useContext(Publication);
  useLayoutEffect(() => {
    if (publish && fence) return publish(controller, fence);
  }, [controller, fence, publish]);
}

/** An older picture's gesture is never a fallback for a successor's chrome. */
export function usePublishedPlayerMorph(fence: PlaybackFence | undefined): PlayerMorphController | undefined {
  const binding = useContext(Published);
  return fence && binding && sameFence(binding.fence, fence) ? binding.controller : undefined;
}
