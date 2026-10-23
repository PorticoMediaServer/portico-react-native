import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {BackHandler, Image, Platform, View, useWindowDimensions} from 'react-native';
import {GestureDetector} from 'react-native-gesture-handler';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {sameFence, type PlaybackFence} from '../../../../packages/player-core/src';
import {useTheme} from '../kit/theme';
import {focusTestID} from '../kit/focus';
import {tvFocusIds} from './tv-focus';
import {DockHost, PlayerMorph, bindNativeDock, usePlayerMorph, type DockPresentation} from '../kit/dock';
import {playbackIdentity} from '../../../../packages/client-core/src/presentation/kit-model';
import type {NativeShellRuntime} from './runtime';
import {sameAuthority, type ShellAuthority} from './model';
import {nativeShellBackTransition, type NativeShellBounds, type NativeShellPlaybackAdapter, type NativeShellVideoSnapshot} from './playback';
import {NativeVideoSnapshotCapture} from './video-snapshot';
import {watchSlotInHost, watchSlotIsCurrent, type ExpandedSlotLayout, type ExpandedSlotReader} from './watch-slot-layout';

/** Lives above route/tab contents. A stable Surface type keeps the actual native view mounted. */
export function NativePlaybackLayer({adapter, runtime, authority}: {adapter: NativeShellPlaybackAdapter; runtime: NativeShellRuntime & Readonly<{watch?: ExpandedSlotReader}>; authority: ShellAuthority}) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  const {width, height} = useWindowDimensions(), theme = useTheme();
  const watch = runtime.watch;
  const subscribeWatch = useCallback((listener: () => void) => watch ? watch.subscribe(listener) : () => {}, [watch]);
  const readWatchSlot = useCallback(() => watch?.getSnapshot(), [watch]);
  const watchSlot = useSyncExternalStore(subscribeWatch, readWatchSlot);
  const window = useMemo(() => ({width, height}), [width, height]);
  const windowFrame = useMemo(() => ({x: 0, y: 0, width, height}), [width, height]);
  const currentWindow = useRef(window), currentWatch = useRef(watch); currentWindow.current = window; currentWatch.current = watch;
  const local = snapshot.dock.local, docked = !!local && !local.expanded;
  const [dockBounds, setDockBounds] = useState<NativeShellBounds>();
  const host = useRef<View>(null), slot = useRef<NativeShellBounds | undefined>(undefined), slotRevision = useRef(0);
  const watchRevision = useRef(0), lastExpandedFrame = useRef<NativeShellBounds | undefined>(undefined);
  const [expandedMeasurement, setExpandedMeasurement] = useState<Readonly<{reader: ExpandedSlotReader; slot: ExpandedSlotLayout; host: View; bounds: NativeShellBounds}>>();
  const expandedBounds = watch && expandedMeasurement?.reader === watch && expandedMeasurement.slot === watchSlot
    && expandedMeasurement.host === host.current && watchSlotIsCurrent(watchSlot, authority, snapshot.fence, window) ? expandedMeasurement.bounds : undefined;
  if (expandedBounds) lastExpandedFrame.current = expandedBounds;
  // A real outlet with no current measurement must never promote a watch
  // picture to the full window. Retain internal morph geometry while hidden.
  const fullFrame = watch ? expandedBounds ?? lastExpandedFrame.current ?? windowFrame : windowFrame;
  const expandedReady = !watch || expandedBounds !== undefined;
  const [picture, setPicture] = useState<Readonly<{owner: NativeVideoSnapshotCapture; authority: ShellAuthority; image: NativeShellVideoSnapshot}> | undefined>(undefined);
  const retainedImage = useRef<Readonly<{owner: NativeVideoSnapshotCapture; image: NativeShellVideoSnapshot}> | undefined>(undefined);
  const [imageState, setImageState] = useState<Readonly<{image: NativeShellVideoSnapshot; state: 'ready' | 'failed'}>>();
  const touching = useRef(false), moving = useRef(false), alive = useRef(true);
  const layoutCapture = useRef<number | undefined>(undefined), layoutCaptureRevision = useRef(0);
  const capture = useMemo(() => new NativeVideoSnapshotCapture({capture: (fence, options) => adapter.captureVideoSnapshot(fence, options), reportError: runtime.reportError,
    changed: (owner, image) => {if (alive.current) {
      if (image) retainedImage.current = {owner, image}; else if (retainedImage.current?.owner === owner) retainedImage.current = undefined;
      setPicture(previous => image ? {owner, authority, image} : previous?.owner === owner ? undefined : previous);
    }},
  }), [adapter, authority, runtime]);
  const action = useMemo(() => bindNativeDock(adapter), [adapter]);
  const morph = usePlayerMorph({docked, fence: snapshot.fence, dockMotionHosted: true, travel: height, onRelease: (collapse, original, fromDocked) => {
    const current = adapter.getSnapshot();
    if (!alive.current || !sameAuthority(current.authority, authority) || !sameFence(current.fence, original)
      || !current.dock.local || (!current.dock.local.expanded) !== fromDocked) return;
    void adapter.onTransition(collapse ? adapter.dock.collapse(original) : adapter.dock.expand(original)).catch(runtime.reportError);
  }});
  const {dockX, dockFade} = morph;
  const prepareLayout = useCallback(async (fence: PlaybackFence) => {
    if (Platform.OS !== 'android' || theme.isTV) return;
    const revision = ++layoutCaptureRevision.current; layoutCapture.current = revision;
    try {
      await capture.prepare(fence, () => {
        const current = adapter.getSnapshot();
        return alive.current && layoutCapture.current === revision && sameAuthority(current.authority, authority) && sameFence(current.fence, fence);
      });
    } finally {if (layoutCapture.current === revision) layoutCapture.current = undefined;}
  }, [adapter, authority, capture, theme.isTV]);
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
    if (state.moving) preparePicture(); else if (!touching.current && layoutCapture.current === undefined) void capture.clear();
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
      const shell = runtime.getSnapshot();
      if (shell.selectionActive || shell.homeObscured) return false;
      const transition = nativeShellBackTransition(adapter.dock, current, authority, theme.isTV);
      if (!transition) return false;
      void adapter.onTransition(transition).catch(runtime.reportError);
      return true;
    });
    return () => back.remove();
  }, [adapter, authority, runtime, theme.isTV]);
  const onSlot = useCallback((bounds: NativeShellBounds) => {
    slot.current = bounds;
    const node = host.current, source = adapter.getSnapshot().fence, revision = ++slotRevision.current;
    if (!node || !source || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return;
    // The art slot is measured in window coordinates. Fabric's viewport origin
    // can include edge-to-edge insets; the persistent overlay uses local bounds.
    node.measureInWindow((x, y) => {
      const current = adapter.getSnapshot();
      if (!alive.current || dockX.value !== 0 || dockFade.value !== 1 || host.current !== node || revision !== slotRevision.current || !sameAuthority(current.authority, authority)
        || !sameFence(current.fence, source) || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const next = {...bounds, x: bounds.x - x, y: bounds.y - y};
      setDockBounds(previous => previous && Object.keys(next).every(key => previous[key as keyof NativeShellBounds] === next[key as keyof NativeShellBounds]) ? previous : next);
    });
  }, [adapter, authority, dockX, dockFade]);
  const measureExpandedSlot = useCallback(() => {
    const source = watch?.getSnapshot(), current = adapter.getSnapshot(), node = host.current, revision = ++watchRevision.current;
    if (docked || !current.dock.local?.expanded || !watch || !node || !sameAuthority(current.authority, authority) || !watchSlotIsCurrent(source, authority, current.fence, currentWindow.current)) return;
    node.measureInWindow((x, y) => {
      const now = adapter.getSnapshot();
      if (!alive.current || !now.dock.local?.expanded || currentWatch.current !== watch || runtime.watch !== watch || host.current !== node || revision !== watchRevision.current
        || watch.getSnapshot() !== source || !sameAuthority(now.authority, authority) || !watchSlotIsCurrent(source, authority, now.fence, currentWindow.current)) return;
      const bounds = watchSlotInHost(source, {x, y});
      if (!bounds) return;
      setExpandedMeasurement(previous => previous?.reader === watch && previous.slot === source && previous.host === node
        && Object.keys(bounds).every(key => previous.bounds[key as keyof NativeShellBounds] === bounds[key as keyof NativeShellBounds]) ? previous : {reader: watch, slot: source, host: node, bounds});
    });
  }, [adapter, authority, docked, runtime, watch]);
  useEffect(() => {measureExpandedSlot();}, [measureExpandedSlot, watchSlot, window, snapshot.fence]);
  const horizontalVideo = docked && (local?.kind === 'video' || local?.kind === 'live');
  const dockMotion = useAnimatedStyle(() => ({opacity: horizontalVideo ? dockFade.value : 1, transform: [{translateX: horizontalVideo ? dockX.value : 0}]}));
  if (!sameAuthority(snapshot.authority, authority)) return null;
  const Surface = adapter.Surface;
  const fence = snapshot.fence;
  const image = picture?.owner === capture && sameAuthority(picture.authority, authority) && fence && sameFence(picture.image.fence, fence) ? picture.image : undefined;
  const imageSettled = (state: 'ready' | 'failed') => {
    const current = adapter.getSnapshot();
    if (alive.current && image && retainedImage.current?.owner === capture && retainedImage.current.image === image && sameAuthority(current.authority, authority) && sameFence(current.fence, image.fence)) setImageState({image, state});
  };
  const presentation: DockPresentation | undefined = fence && snapshot.subject ? {fence, identity: playbackIdentity(snapshot.subject, 'dock', runtime.text),
    artwork: runtime.artwork(snapshot.entry?.posterUrl), ambient: runtime.ambient(snapshot.entry?.posterUrl), durationSeconds: snapshot.playback.duration > 0 ? snapshot.playback.duration : undefined,
    seekWindow: snapshot.seekWindow ? {start: snapshot.seekWindow.startSeconds, end: snapshot.seekWindow.endSeconds} : undefined,
    finished: snapshot.playback.phase === 'ended', skipBackSeconds: runtime.skipBackSeconds, capabilities: snapshot.capabilities} : undefined;
  return <View ref={host} collapsable={false} onLayout={() => {if (slot.current) onSlot(slot.current); measureExpandedSlot();}} pointerEvents="box-none" testID="native-persistent-playback" style={{position: 'absolute', inset: 0, zIndex: theme.layers.player}}>
    <Animated.View pointerEvents="box-none" style={[{position: 'absolute', inset: 0}, dockMotion]}>
      <PlayerMorph controller={morph} fence={fence} docked={docked} fullFrame={fullFrame} dockFrame={dockBounds ?? fullFrame}
        onPresentationChange={onPresentationChange} prepareLayout={prepareLayout} androidSnapshot={image ? {fence: image.fence, ready: imageState?.image === image && imageState.state === 'ready',
          failed: imageState?.image === image && imageState.state === 'failed', image: <Image source={{uri: image.image.uri}} onLoad={() => imageSettled('ready')} onError={() => imageSettled('failed')} resizeMode="contain" style={{width: '100%', height: '100%'}}/>} : undefined}>
        {context => <Surface dockBounds={dockBounds ? context.bounds : undefined} expandedBounds={expandedReady ? context.bounds : undefined} docked={context.docked} subtitlesVisible={context.subtitlesVisible} surfaceActive={context.surfaceActive}/>}
      </PlayerMorph>
      {fence && local?.expanded && !theme.isTV && expandedReady && <GestureDetector gesture={morph.gesture}>
        <View onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={touchEnd} accessible={false} style={watch ? {position: 'absolute', left: fullFrame.x, top: fullFrame.y, width: fullFrame.width, height: fullFrame.height} : {position: 'absolute', inset: 0}}/>
      </GestureDetector>}
      <View pointerEvents="box-none" onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={touchEnd} style={{position: 'absolute', inset: 0}}>
        <DockHost testID={theme.isTV && fence ? focusTestID(tvFocusIds(authority).surface('playback'), JSON.stringify(fence)) : undefined} dock={adapter.dock} snapshot={snapshot.dock} presentation={{local: presentation}} morph={morph} onVideoSlot={onSlot}
          onAction={command => {void action(command).catch(runtime.reportError);}}/>
      </View>
    </Animated.View>
  </View>;
}
