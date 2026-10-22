import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {BackHandler, Image, Platform, View, useWindowDimensions} from 'react-native';
import {GestureDetector} from 'react-native-gesture-handler';
import {sameFence, type PlaybackFence} from '../../../../packages/player-core/src';
import {useTheme} from '../kit/theme';
import {DockHost, PlayerMorph, bindNativeDock, usePlayerMorph, type DockPresentation} from '../kit/dock';
import {playbackIdentity} from '../../../../packages/client-core/src/presentation/kit-model';
import type {NativeShellRuntime} from './runtime';
import {sameAuthority, type ShellAuthority} from './model';
import {nativeShellBackTransition, type NativeShellBounds, type NativeShellPlaybackAdapter, type NativeShellVideoSnapshot} from './playback';
import {NativeVideoSnapshotCapture} from './video-snapshot';

/** Lives above route/tab contents. A stable Surface type keeps the actual native view mounted. */
export function NativePlaybackLayer({adapter, runtime, authority}: {adapter: NativeShellPlaybackAdapter; runtime: NativeShellRuntime; authority: ShellAuthority}) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  const {width, height} = useWindowDimensions(), theme = useTheme();
  const [dockBounds, setDockBounds] = useState<NativeShellBounds>();
  const [picture, setPicture] = useState<Readonly<{owner: NativeVideoSnapshotCapture; authority: ShellAuthority; image: NativeShellVideoSnapshot}> | undefined>(undefined);
  const touching = useRef(false), moving = useRef(false), alive = useRef(true);
  const capture = useMemo(() => new NativeVideoSnapshotCapture({capture: (fence, options) => adapter.captureVideoSnapshot(fence, options), reportError: runtime.reportError,
    changed: (owner, image) => {if (alive.current) setPicture(previous => image ? {owner, authority, image} : previous?.owner === owner ? undefined : previous);},
  }), [adapter, authority, runtime]);
  const local = snapshot.dock.local, docked = !!local && !local.expanded;
  const action = useMemo(() => bindNativeDock(adapter), [adapter]);
  const morph = usePlayerMorph({docked, travel: height, onRelease: collapse => {
    const current = adapter.getSnapshot();
    if (!sameAuthority(current.authority, authority) || !current.fence) return;
    void adapter.onTransition(collapse ? adapter.dock.collapse(current.fence) : adapter.dock.expand(current.fence)).catch(runtime.reportError);
  }});
  const preparePicture = useCallback(() => {
    const current = adapter.getSnapshot();
    if (Platform.OS !== 'android' || theme.isTV || !alive.current || !sameAuthority(current.authority, authority) || !current.fence
      || !current.dock.local || !['video', 'live'].includes(current.dock.local.kind)) return;
    const fence = current.fence;
    void capture.prepare(fence, () => {
      const now = adapter.getSnapshot();
      return alive.current && sameAuthority(now.authority, authority) && sameFence(now.fence, fence)
        && (touching.current || moving.current || morph.dragging.value);
    });
  }, [adapter, authority, capture, morph.dragging, theme.isTV]);
  const onPresentationChange = useCallback((state: Readonly<{fence: PlaybackFence; docked: boolean; moving: boolean; hideSubtitles: boolean}>) => {
    const current = adapter.getSnapshot();
    if (!sameAuthority(current.authority, authority) || !sameFence(current.fence, state.fence)) return;
    moving.current = state.moving;
    if (state.moving) preparePicture(); else if (!touching.current) void capture.clear();
  }, [adapter, authority, capture, preparePicture]);
  const touchStart = () => {touching.current = true; preparePicture();};
  const touchEnd = () => {touching.current = false; if (!moving.current && !morph.dragging.value) void capture.clear();};
  useEffect(() => {
    const current = adapter.getSnapshot();
    if (!sameAuthority(current.authority, authority) || !capture.matches(current.fence)) {
      touching.current = false; moving.current = false; void capture.clear();
    }
  }, [adapter, authority, snapshot.fence, capture]);
  useEffect(() => {alive.current = true; return () => {alive.current = false; touching.current = false; moving.current = false; void capture.clear();};}, [capture]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      const current = adapter.getSnapshot();
      const transition = nativeShellBackTransition(adapter.dock, current, authority, theme.isTV);
      if (!transition) return false;
      void adapter.onTransition(transition).catch(runtime.reportError);
      return true;
    });
    return () => back.remove();
  }, [adapter, authority, runtime, theme.isTV]);
  const onSlot = useCallback((bounds: NativeShellBounds) => setDockBounds(previous => previous && Object.keys(bounds).every(key => previous[key as keyof NativeShellBounds] === bounds[key as keyof NativeShellBounds]) ? previous : bounds), []);
  if (!sameAuthority(snapshot.authority, authority)) return null;
  const Surface = adapter.Surface;
  const fence = snapshot.fence;
  const image = picture?.owner === capture && sameAuthority(picture.authority, authority) && fence && sameFence(picture.image.fence, fence) ? picture.image : undefined;
  const presentation: DockPresentation | undefined = fence && snapshot.subject ? {fence, identity: playbackIdentity(snapshot.subject, 'dock', runtime.text),
    artwork: runtime.artwork(snapshot.entry?.posterUrl), ambient: runtime.ambient(snapshot.entry?.posterUrl), durationSeconds: snapshot.playback.duration > 0 ? snapshot.playback.duration : undefined,
    seekWindow: snapshot.seekWindow ? {start: snapshot.seekWindow.startSeconds, end: snapshot.seekWindow.endSeconds} : undefined,
    finished: snapshot.playback.phase === 'ended', skipBackSeconds: runtime.skipBackSeconds, capabilities: snapshot.capabilities} : undefined;
  const fullFrame = {x: 0, y: 0, width, height};
  return <View pointerEvents="box-none" testID="native-persistent-playback" style={{position: 'absolute', inset: 0, zIndex: theme.layers.player}}>
    <PlayerMorph controller={morph} fence={fence} docked={docked && !!dockBounds} fullFrame={fullFrame} dockFrame={dockBounds ?? fullFrame}
      onPresentationChange={onPresentationChange} androidSnapshot={image ? {fence: image.fence, image: <Image source={{uri: image.image.uri}} resizeMode="contain" style={{width: '100%', height: '100%'}}/>} : undefined}>
      {context => <Surface dockBounds={context.bounds} expandedBounds={context.bounds} docked={context.docked} subtitlesVisible={context.subtitlesVisible}/>}
    </PlayerMorph>
    {fence && local?.expanded && !theme.isTV && <GestureDetector gesture={morph.gesture}>
      <View onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={touchEnd} accessible={false} style={{position: 'absolute', inset: 0}}/>
    </GestureDetector>}
    <View pointerEvents="box-none" onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={touchEnd} style={{position: 'absolute', inset: 0}}>
      <DockHost dock={adapter.dock} snapshot={snapshot.dock} presentation={{local: presentation}} morph={morph} onVideoSlot={onSlot}
        onAction={command => {void action(command).catch(runtime.reportError);}}/>
    </View>
  </View>;
}
