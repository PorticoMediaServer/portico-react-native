import React, {useCallback, useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {BackHandler, View, useWindowDimensions} from 'react-native';
import {useTheme} from '../kit/theme';
import {DockHost, PlayerMorph, bindNativeDock, usePlayerMorph, type DockPresentation} from '../kit/dock';
import {playbackIdentity} from '../../../../packages/client-core/src/presentation/kit-model';
import type {NativeShellRuntime} from './runtime';
import {sameAuthority, type ShellAuthority} from './model';
import type {NativeShellBounds, NativeShellPlaybackAdapter} from './playback';

/** Lives above route/tab contents. A stable Surface type keeps the actual native view mounted. */
export function NativePlaybackLayer({adapter, runtime, authority}: {adapter: NativeShellPlaybackAdapter; runtime: NativeShellRuntime; authority: ShellAuthority}) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  const {width, height} = useWindowDimensions(), theme = useTheme();
  const [dockBounds, setDockBounds] = useState<NativeShellBounds>();
  const local = snapshot.dock.local, docked = !!local && !local.expanded;
  const action = useMemo(() => bindNativeDock(adapter), [adapter]);
  const morph = usePlayerMorph({docked, travel: height, onRelease: collapse => {
    const current = adapter.getSnapshot();
    if (!sameAuthority(current.authority, authority) || !current.fence) return;
    void adapter.onTransition(collapse ? adapter.dock.collapse(current.fence) : adapter.dock.expand(current.fence)).catch(runtime.reportError);
  }});
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      const current = adapter.getSnapshot();
      if (!sameAuthority(current.authority, authority) || !current.fence || !current.dock.local?.expanded) return false;
      void adapter.onTransition(adapter.dock.collapse(current.fence)).catch(runtime.reportError);
      return true;
    });
    return () => back.remove();
  }, [adapter, authority, runtime]);
  const onSlot = useCallback((bounds: NativeShellBounds) => setDockBounds(previous => previous && Object.keys(bounds).every(key => previous[key as keyof NativeShellBounds] === bounds[key as keyof NativeShellBounds]) ? previous : bounds), []);
  if (!sameAuthority(snapshot.authority, authority)) return null;
  const Surface = adapter.Surface;
  const fence = snapshot.fence;
  const presentation: DockPresentation | undefined = fence && snapshot.subject ? {fence, identity: playbackIdentity(snapshot.subject, 'dock', runtime.text),
    artwork: runtime.artwork(snapshot.entry?.posterUrl), ambient: runtime.ambient(snapshot.entry?.posterUrl), durationSeconds: snapshot.playback.duration > 0 ? snapshot.playback.duration : undefined,
    finished: snapshot.playback.phase === 'ended', skipBackSeconds: runtime.skipBackSeconds, capabilities: snapshot.capabilities} : undefined;
  const fullFrame = {x: 0, y: 0, width, height};
  return <View pointerEvents="box-none" testID="native-persistent-playback" style={{position: 'absolute', inset: 0, zIndex: theme.layers.player}}>
    {fence && <PlayerMorph controller={morph} fence={fence} docked={docked && !!dockBounds} fullFrame={fullFrame} dockFrame={dockBounds ?? fullFrame}>
      {context => <Surface dockBounds={context.bounds} expandedBounds={context.bounds} docked={context.docked} subtitlesVisible={context.subtitlesVisible}/>}
    </PlayerMorph>}
    <DockHost dock={adapter.dock} snapshot={snapshot.dock} presentation={{local: presentation}} morph={morph} onVideoSlot={onSlot}
      onAction={command => {void action(command).catch(runtime.reportError);}}/>
  </View>;
}
