import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {BackHandler, Image, Platform, View, useWindowDimensions} from 'react-native';
import {GestureDetector} from 'react-native-gesture-handler';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {sameFence, type PlaybackFence} from '../../../../packages/player-core/src';
import {useTheme} from '../kit/theme';
import {focusTestID} from '../kit/focus';
import {tvFocusIds} from './tv-focus';
import {DockHost, PlayerMorph, bindNativeDock, usePlayerMorph, type DockPresentation} from '../kit/dock';
import {currentOccupant, playbackPosition} from '../kit/dock/model';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {NowPlayingScreen} from '../screens/destinations/music/NowPlayingScreen';
import {NowPlayingLyrics} from '../screens/destinations/music/NowPlayingLyrics';
import type {LyricsTarget} from '../../../../packages/client-core/src/lyrics';
import {musicSignalView} from '../screens/destinations/music/MusicSignal';
import {NativeListeningNotice} from '../screens/destinations/music/ListeningNotice';
import {nativeMusicSignal} from '../screens/destinations/music/signal-facts';
import {nativeEqualizer} from '../platform/playback/equalizer';
import {listeningNoticeKey} from '../../../../packages/client-core/src/audio-effects';
import {playbackIdentity} from '../../../../packages/client-core/src/presentation/kit-model';
import type {NativeShellRuntime} from './runtime';
import {sameAuthority, type ShellAuthority} from './model';
import {nativeShellBackTransition, type NativeShellBounds, type NativeShellPlaybackAdapter, type NativeShellPlaybackSnapshot, type NativeShellVideoSnapshot} from './playback';
import {NativeVideoSnapshotCapture} from './video-snapshot';
import {watchSlotInHost, watchSlotIsCurrent} from './watch-slot-layout';
import type {NativeExpandedVideoSlot, NativeWatchReader} from './watch-outlet';

/** Lives above route/tab contents. A stable Surface type keeps the actual native view mounted. */
export function NativePlaybackLayer({adapter, runtime, authority}: {adapter: NativeShellPlaybackAdapter; runtime: NativeShellRuntime; authority: ShellAuthority}) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  const {width, height} = useWindowDimensions(), theme = useTheme(), insets = useSafeAreaInsets();
  const watch = runtime.watch;
  const subscribeWatch = useCallback((listener: () => void) => watch ? watch.subscribe(listener) : () => {}, [watch]);
  const readWatchSlot = useCallback(() => watch?.getSnapshot(), [watch]);
  const watchSlot = useSyncExternalStore(subscribeWatch, readWatchSlot);
  const window = useMemo(() => ({width, height}), [width, height]);
  const windowFrame = useMemo(() => ({x: 0, y: 0, width, height}), [width, height]);
  const currentWindow = useRef(window), currentWatch = useRef(watch); currentWindow.current = window; currentWatch.current = watch;
  const local = snapshot.dock.local, docked = !!local && !local.expanded;
  const fence = snapshot.fence;
  const [dockMeasurement, setDockMeasurement] = useState<Readonly<{fence: PlaybackFence; bounds: NativeShellBounds}>>();
  // A docked picture is only real at a slot measured for THIS fence. An old
  // slot or the full-window fallback must never stand in for current geometry.
  const dockSlot = dockMeasurement && fence && sameFence(dockMeasurement.fence, fence) ? dockMeasurement.bounds : undefined;
  // Only the current occupant's own video/live item has a picture. Audio and an
  // empty dock keep the SAME mounted Surface, ref and owner (unmounting disposes
  // the runtime), but they have no picture to paint, measure, produce or drag.
  const pictureFence = fence && local && sameFence(local.fence, fence) && (local.kind === 'video' || local.kind === 'live')
    && (!docked || dockSlot !== undefined) ? fence : undefined;
  const host = useRef<View>(null), slot = useRef<NativeShellBounds | undefined>(undefined), slotRevision = useRef(0);
  const watchRevision = useRef(0), lastExpandedFrame = useRef<NativeShellBounds | undefined>(undefined);
  const [expandedMeasurement, setExpandedMeasurement] = useState<Readonly<{reader: NativeWatchReader; slot: NativeExpandedVideoSlot; host: View; bounds: NativeShellBounds}>>();
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
  const playOn = runtime.playOn;
  const action = useMemo(() => bindNativeDock(adapter, playOn ? {remote: async command => {await playOn.command(command.type, command.positionSeconds, command.remote.id);}} : {}), [adapter, playOn]);
  const morph = usePlayerMorph({docked, fence: snapshot.fence, dockMotionHosted: true, travel: height, onRelease: (collapse, original, fromDocked) => {
    const current = adapter.getSnapshot();
    if (!alive.current || !sameAuthority(current.authority, authority) || !sameFence(current.fence, original)
      || !current.dock.local || (!current.dock.local.expanded) !== fromDocked) return;
    void adapter.onTransition(collapse ? adapter.dock.collapse(original) : adapter.dock.expand(original)).catch(runtime.reportError);
  }});
  const {dockX, dockFade} = morph;
  const prepareLayout = useCallback(async (fence: PlaybackFence) => {
    if (!['android', 'ios'].includes(Platform.OS) || theme.isTV) return;
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
    if (!['android', 'ios'].includes(Platform.OS) || theme.isTV || !alive.current || !sameAuthority(current.authority, authority) || !current.fence
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
      setDockMeasurement(previous => previous && sameFence(previous.fence, source)
        && Object.keys(next).every(key => previous.bounds[key as keyof NativeShellBounds] === next[key as keyof NativeShellBounds])
        ? previous : {fence: source, bounds: next});
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
  const equalizer = useSyncExternalStore(nativeEqualizer.subscribe, nativeEqualizer.getSnapshot);
  // music-plus (MC-8): the line is the committed plan plus the engine's own facts, or nothing.
  const signal = useMemo(() => {const input = nativeMusicSignal(snapshot, equalizer.value); return input ? musicSignalView(input) : undefined;}, [snapshot, equalizer.value]);
  // The song's own lyrics need the session-bound target the server validates: the queue
  // fence's session and source, and the entry's library. Keys, not objects, so a position
  // update cannot rebuild the reader; the reader itself is owned by the lyric panel.
  const lyricsKeys = nativeLyricsTargetKey(snapshot);
  const lyricsTarget = useMemo<LyricsTarget | undefined>(() => {
    if (!lyricsKeys) return undefined;
    const [sessionId, sessionGeneration, itemId, sourceId, libraryId] = JSON.parse(lyricsKeys) as [string, number, string, string, string];
    return {itemId, libraryId, sessionId, sessionGeneration, ...(sourceId ? {sourceId} : {})};
  }, [lyricsKeys]);
  const lyricsOffered = !!lyricsTarget && !!runtime.lyrics && runtime.lyricsEnabled?.() === true;
  if (!sameAuthority(snapshot.authority, authority)) return null;
  const Surface = adapter.Surface;
  const image = picture?.owner === capture && sameAuthority(picture.authority, authority) && fence && sameFence(picture.image.fence, fence) ? picture.image : undefined;
  const imageSettled = (state: 'ready' | 'failed') => {
    const current = adapter.getSnapshot();
    if (alive.current && image && retainedImage.current?.owner === capture && retainedImage.current.image === image && sameAuthority(current.authority, authority) && sameFence(current.fence, image.fence)) setImageState({image, state});
  };
  const presentation: DockPresentation | undefined = fence && snapshot.subject ? {fence, identity: playbackIdentity(snapshot.subject, 'dock', runtime.text),
    artwork: runtime.artwork(snapshot.entry?.posterUrl), ambient: runtime.ambient(snapshot.entry?.posterUrl), durationSeconds: snapshot.playback.duration > 0 ? snapshot.playback.duration : undefined,
    seekWindow: snapshot.seekWindow ? {start: snapshot.seekWindow.startSeconds, end: snapshot.seekWindow.endSeconds} : undefined,
    finished: snapshot.playback.phase === 'ended', skipBackSeconds: runtime.skipBackSeconds, skipForwardSeconds: runtime.skipForwardSeconds, capabilities: snapshot.capabilities} : undefined;
  // tablet-play9/10: a music or audiobook occupant that the viewer expanded is the
  // listening surface, drawn from the same dock occupant and the listening owner's
  // queue. The dock stays underneath; this never starts a second session.
  const dockedLocal = snapshot.dock.local;
  const nowPlaying = presentation && dockedLocal?.expanded === true && (dockedLocal.kind === 'music' || dockedLocal.kind === 'audiobook')
    && sameFence(dockedLocal.fence, presentation.fence) ? currentOccupant(adapter.dock, snapshot.dock, {local: presentation}) : null;
  return <View ref={host} collapsable={false} onLayout={() => {if (slot.current) onSlot(slot.current); measureExpandedSlot();}} pointerEvents="box-none" testID="native-persistent-playback" style={{position: 'absolute', inset: 0, zIndex: theme.layers.player}}>
    <Animated.View pointerEvents="box-none" style={[{position: 'absolute', inset: 0}, dockMotion]}>
      <PlayerMorph controller={morph} fence={pictureFence} docked={docked} fullFrame={fullFrame} dockFrame={dockSlot ?? fullFrame}
        onPresentationChange={onPresentationChange} prepareLayout={prepareLayout} retainedSnapshot={pictureFence && image ? {fence: image.fence, ready: imageState?.image === image && imageState.state === 'ready',
          failed: imageState?.image === image && imageState.state === 'failed', image: <Image source={{uri: image.image.uri}} onLoad={() => imageSettled('ready')} onError={() => imageSettled('failed')} resizeMode="contain" style={{width: '100%', height: '100%'}}/>} : undefined}>
        {context => <Surface dockBounds={pictureFence && dockSlot ? context.bounds : undefined} expandedBounds={pictureFence && expandedReady ? context.bounds : undefined} docked={context.docked} subtitlesVisible={context.subtitlesVisible} surfaceActive={!!pictureFence && context.surfaceActive}/>}
      </PlayerMorph>
      {pictureFence && local?.expanded && !theme.isTV && expandedReady && <GestureDetector gesture={morph.gesture}>
        <View onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={touchEnd} accessible={false} style={watch ? {position: 'absolute', left: fullFrame.x, top: fullFrame.y, width: fullFrame.width, height: fullFrame.height} : {position: 'absolute', inset: 0}}/>
      </GestureDetector>}
      <View pointerEvents="box-none" onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={touchEnd} style={{position: 'absolute', inset: 0}}>
        {(!theme.isTV || !nowPlaying) && <DockHost testID={theme.isTV && fence ? focusTestID(tvFocusIds(authority).surface('playback'), JSON.stringify(fence)) : undefined} dock={adapter.dock} snapshot={snapshot.dock} presentation={{local: presentation}} morph={morph} onVideoSlot={onSlot}
          tvExpanded={!!dockedLocal?.expanded} onTVExpandedChange={open => {if (fence) void action({type: open ? 'expand' : 'collapse', fence}).catch(runtime.reportError);}}
          onAction={command => {void action(command).catch(runtime.reportError);}}/>}
        {!nowPlaying && dockedLocal?.expanded !== true && snapshot.playback.listeningNotice && <NativeListeningNotice key={snapshot.playback.listeningNotice}
          notice={listeningNoticeKey(snapshot.playback.listeningNotice)} bottomOffset={insets.bottom + (theme.platform === 'tablet' ? 66 : 62) + 10}/>}
        {nowPlaying && (nowPlaying.mode === 'music' || nowPlaying.mode === 'audiobook') && <NowPlayingScreen occupant={nowPlaying} queue={snapshot.queue?.view ?? undefined} artwork={runtime.artwork}
          width={width} height={height} topInset={insets.top} bottomInset={insets.bottom} onAction={command => {void action(command).catch(runtime.reportError);}}
          onQueuePlay={adapter.queuePlay ? (queueId, entryId, revision) => {void adapter.queuePlay!(queueId, entryId, revision).catch(runtime.reportError);} : undefined}
          signal={signal} notice={snapshot.playback.listeningNotice ? listeningNoticeKey(snapshot.playback.listeningNotice) : undefined} reportError={runtime.reportError}
          lyrics={lyricsOffered && lyricsTarget && runtime.lyrics && nowPlaying ? <NowPlayingLyrics read={runtime.lyrics} target={lyricsTarget}
            positionSeconds={playbackPosition(nowPlaying)} playing={nowPlaying.playback.playing}
            onSeek={seconds => {const current = adapter.getSnapshot(); if (current.fence && sameFence(current.fence, nowPlaying.playback.fence)) void adapter.seek(current.fence, seconds).catch(runtime.reportError);}}/> : undefined}
          onClose={() => {const current = adapter.getSnapshot(); if (current.dock.local?.expanded && current.fence && sameFence(current.fence, nowPlaying.playback.fence)) void adapter.onTransition(adapter.dock.collapse(current.fence)).catch(runtime.reportError);}}/>}
      </View>
    </Animated.View>
  </View>;
}

/** The current song's lyric target, as a stable key string: the queue fence's session
 * and source plus the entry's library. Empty when no song is playing on a queue. */
function nativeLyricsTargetKey(snapshot: NativeShellPlaybackSnapshot): string {
  const dock = snapshot.dock.local, fence = snapshot.fence, entry = snapshot.entry;
  if (!dock || dock.expanded !== true || dock.kind !== 'music' || !fence || fence.kind !== 'queue' || !sameFence(dock.fence, fence) || !entry?.libraryId) return '';
  return JSON.stringify([fence.sessionId, fence.generation, fence.itemId, fence.sourceId ?? '', entry.libraryId]);
}
