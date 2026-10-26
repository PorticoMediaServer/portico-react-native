import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Text, View, useTVEventHandler} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {runOnJS, useAnimatedStyle, useSharedValue} from 'react-native-reanimated';
import {sameFence} from '../../../../../packages/player-core/src';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativePlaybackRuntimeSnapshot} from '../../platform/playback/types';
import type {NativeShellPlaybackAdapter} from '../../shell/playback';
import {Focusable} from '../../kit/controls';
import {useTheme} from '../../kit/theme';
import type {NativeWatchControls} from './controls';
import {NativeTrickplayStrip} from './TrickplayStrip';

type Props = Readonly<{
  source: NativePlaybackRuntimeSnapshot;
  controls: NativeWatchControls;
  playback: Pick<NativeShellPlaybackAdapter, 'getSnapshot' | 'seek' | 'toggle'>;
  compact: boolean;
  enabled: boolean;
  reportError: (error: unknown) => void;
  skipBackSeconds: number;
  skipForwardSeconds: number;
  /** TV draws its own bar (tv-player 2 and 12): the 8pt track grows to 12 and
   * the knob to 30 under focus, the stretch about to be skipped is tinted, and
   * the recap, intro and credit bands are named under the bar. */
  tv?: boolean;
  focused?: boolean;
  /** The live group pill's native host while one is drawn, so TV Up from the seek reaches it. */
  /** Down leaves the preview and restores the transport after its hosts remount. */
  /** The landing time while the bar is being moved, for the TV key hints. */
  onPreview?: (seconds: number | undefined) => void;
  /** Live: the retained window's live edge. The stretch behind it is what the
   * server lets you rewind, and a red mark rides the edge (tv-player 11). */
  liveEdge?: number;
}>;

/** Actual time/window only. Scrub commits on lift; absent trickplay never becomes invented imagery. */
export function NativeWatchTimeline({source, playback, controls, compact, enabled, reportError, skipBackSeconds, skipForwardSeconds, tv = false, focused = false, onPreview, liveEdge}: Props) {
  const theme = useTheme(), fence = source.fence, width = useRef(0), dragging = useRef(false);
  const [preview, setPreview] = useState<number>();
  const previewRef = useRef<number | undefined>(undefined), seekRef = useRef<View>(null), mounted = useRef(false);
  const start = source.seekWindow?.startSeconds ?? 0, end = source.seekWindow?.endSeconds ?? source.playback.duration;
  const span = end - start;
  useLayoutEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const current = useCallback(() => {
    const live = playback.getSnapshot();
    return mounted.current && !!fence && sameFence(live.fence, fence) && !source.retired && (!tv || live.dock.local?.expanded === true);
  }, [fence, playback, source.retired, tv]);
  useEffect(() => {dragging.current = false; setPreview(undefined); onPreview?.(undefined);}, [fence, onPreview]);
  const clearRemotePreview = useCallback(() => {
    previewRef.current = undefined; setPreview(undefined); onPreview?.(undefined);
    if (fence) controls.scrub(fence, false);
  }, [controls, fence, onPreview]);
  const remoteScrubbing = tv && preview !== undefined && previewRef.current !== undefined;
  useLayoutEffect(() => {
    if (!tv || !focused || !enabled || !fence) {clearRemotePreview(); return;}
    if (!remoteScrubbing) return;
    const unregister = controls.registerScrubCancel(fence, clearRemotePreview);
    return () => {unregister(); clearRemotePreview();};
  }, [clearRemotePreview, controls, enabled, fence, focused, remoteScrubbing, tv]);
  useTVEventHandler(event => {
    if (!tv || !focused || !enabled || !fence || !current() || !source.capabilities.seek || !(span > 0) || event.eventKeyAction === 1) return;
    if (event.eventType === 'down' && previewRef.current !== undefined) {
      clearRemotePreview();
      return;
    }
    const left = event.eventType === 'left' || event.eventType === 'longLeft';
    const right = event.eventType === 'right' || event.eventType === 'longRight';
    if (!left && !right) return;
    const live = playback.getSnapshot();
    const next = Math.max(start, Math.min(end, (previewRef.current ?? live.playback.positionSeconds) + (left ? -skipBackSeconds : skipForwardSeconds)));
    if (previewRef.current !== undefined || live.playback.intent === 'paused' || event.eventType === 'longLeft' || event.eventType === 'longRight') {
      previewRef.current = next; setPreview(next); onPreview?.(next); controls.scrub(fence, true);
    } else void playback.seek(fence, next).catch(reportError);
  });
  // The touch bar paints its own progress and knob from the real pointer on the UI
  // thread; the preview seconds, the time label and the single lift seek stay on
  // the existing callbacks below, so nothing here commits a position.
  const travel = useSharedValue(0), paintFraction = useSharedValue(0), dragFraction = useSharedValue<number | null>(null);
  // No fraction, no span or no measured travel means no preview and no seek, exactly as the
  // previous unmeasured track behaved.
  const secondsAt = useCallback((fraction: number | undefined) => fraction === undefined || !(span > 0) ? undefined : Math.max(start, Math.min(end, start + fraction * span)), [start, end, span]);
  const beginDrag = useCallback((fraction: number | undefined) => {
    if (!fence || !current()) return;
    dragging.current = true; controls.scrub(fence, true);
    const landing = secondsAt(fraction); setPreview(landing); onPreview?.(landing);
  }, [controls, current, fence, onPreview, secondsAt]);
  const updateDrag = useCallback((fraction: number) => {
    if (!dragging.current || !current()) return;
    const landing = secondsAt(fraction); setPreview(landing); onPreview?.(landing);
  }, [current, onPreview, secondsAt]);
  const finishDrag = useCallback((fraction: number, success: boolean) => {
    // Only the library's own success argument proves a lift; a cancel reaches
    // onEnd(event, false) and commits nothing.
    if (success !== true) return;
    const seconds = secondsAt(fraction);
    if (fence && dragging.current && current() && seconds !== undefined) void playback.seek(fence, seconds).catch(reportError);
  }, [current, fence, playback, reportError, secondsAt]);
  const endDrag = useCallback(() => {
    dragging.current = false; setPreview(undefined); onPreview?.(undefined); if (fence) controls.scrub(fence, false);
  }, [controls, fence, onPreview]);
  const gesture = useMemo(() => Gesture.Pan().enabled(enabled && source.capabilities.seek).minDistance(0)
    .onBegin(event => {
      if (!(travel.value > 0)) {runOnJS(beginDrag)(undefined); return;}
      const fraction = Math.max(0, Math.min(1, event.x / travel.value));
      dragFraction.value = fraction;
      runOnJS(beginDrag)(fraction);
    })
    .onUpdate(event => {
      if (!(travel.value > 0)) return;
      const fraction = Math.max(0, Math.min(1, event.x / travel.value));
      dragFraction.value = fraction;
      runOnJS(updateDrag)(fraction);
    })
    .onEnd((event, success) => {
      if (success !== true || !(travel.value > 0)) return;
      runOnJS(finishDrag)(Math.max(0, Math.min(1, event.x / travel.value)), true);
    }).onFinalize(() => {dragFraction.value = null; runOnJS(endDrag)();}),
    [enabled, source.capabilities.seek, beginDrag, updateDrag, finishDrag, endDrag, travel, dragFraction]);
  const position = preview ?? source.playback.positionSeconds, progress = span > 0 ? Math.max(0, Math.min(1, (position - start) / span)) : 0;
  const played = span > 0 ? Math.max(0, Math.min(1, (source.playback.positionSeconds - start) / span)) : 0;
  // An external position only retargets the paint when no finger is down.
  useEffect(() => {if (dragFraction.value === null) paintFraction.value = tv ? played : progress;}, [dragFraction, paintFraction, played, progress, tv]);
  useEffect(() => () => {dragFraction.value = null;}, [dragFraction]);
  // Fixed geometry, moved by transform only: the fill scales about its centre and is
  // translated back to the left edge, the knob translates from the bar's start.
  const fillPaint = useAnimatedStyle(() => {
    const fraction = dragFraction.value ?? paintFraction.value;
    return {transform: [{translateX: -(1 - fraction) * travel.value / 2}, {scaleX: fraction}]};
  });
  const knobPaint = useAnimatedStyle(() => ({transform: [{translateX: (dragFraction.value ?? paintFraction.value) * travel.value}]}));
  const markers = source.options?.itemId === (fence?.kind === 'queue' ? fence.itemId : undefined) ? source.options?.markers ?? [] : [];
  const marks = markers.filter(marker => ['intro', 'recap', 'credits'].includes(marker.type) && marker.endMs > marker.startMs && marker.startMs / 1000 < end && marker.endMs / 1000 > start);
  const adjust = (seconds: number) => {if (fence && current()) void playback.seek(fence, Math.max(start, Math.min(end, position + seconds))).catch(reportError);};
  const track = tv ? focused ? 12 : 8 : compact ? 3 : 4, knob = tv ? focused ? 30 : 22 : 14;
  const label = (marker: typeof marks[number]) => marker.type === 'intro' ? defaultI18n.t('player.marker.intro') : marker.type === 'recap' ? defaultI18n.t('player.marker.recap') : defaultI18n.t('player.marker.credits');
  const seek = (size: number) => <Focusable ref={seekRef} accessibilityRole="adjustable" accessibilityLabel={defaultI18n.t('player.position')} accessibilityValue={{min: start, max: Math.max(start, end), now: Math.max(start, Math.min(end, position))}}
    focusId="watch-seek" testID="watch-seek" focusable={enabled} disabled={!enabled || !source.capabilities.seek}
    accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]} onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'increment') adjust(skipForwardSeconds); else if (event.nativeEvent.actionName === 'decrement') adjust(-skipBackSeconds);}}
    onPress={() => {if (!fence || !current()) return; const landing = previewRef.current ?? position;
      clearRemotePreview();
      void playback.seek(fence, landing).then(() => {if (current() && playback.getSnapshot().playback.intent !== 'playing') return playback.toggle(fence);}).catch(reportError);}}
    style={{height: size, justifyContent: 'center'}}>
    {({focused: ring}) => <View pointerEvents="none" style={{height: track, backgroundColor: liveEdge === undefined ? 'rgba(237,245,250,.22)' : 'rgba(237,245,250,.1)', borderRadius: tv ? track / 2 : compact ? 0 : 4}}>
      {liveEdge !== undefined && span > 0 && <View style={{position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.max(0, Math.min(1, (liveEdge - start) / span)) * 100}%`, backgroundColor: 'rgba(237,245,250,.3)', borderRadius: 4}}/>}
      {tv
        ? <View style={{position: 'absolute', top: 0, bottom: 0, left: 0, width: `${played * 100}%`, backgroundColor: theme.colors.accentStrong, borderRadius: track / 2}}/>
        : <Animated.View style={[{position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.accentStrong, borderRadius: 2}, fillPaint]}/>}
      {liveEdge !== undefined && span > 0 && <View style={{position: 'absolute', top: '50%', left: `${Math.max(0, Math.min(1, (liveEdge - start) / span)) * 100}%`, width: 4, height: 30, marginTop: -15, marginLeft: -2, borderRadius: 2, backgroundColor: theme.colors.record}}/>}
      {tv && preview !== undefined && preview > source.playback.positionSeconds && <View style={{position: 'absolute', top: 0, bottom: 0, left: `${played * 100}%`, width: `${Math.max(0, progress - played) * 100}%`, backgroundColor: 'rgba(92,179,226,.42)'}}/>}
      {span > 0 && marks.map((marker, index) => {
        const first = index === 0, last = index === marks.length - 1;
        return <View key={marker.id} style={[{position: 'absolute', top: 0, bottom: 0, left: `${Math.max(0, (marker.startMs / 1000 - start) / span) * 100}%`,
          width: `${Math.min(1, (marker.endMs - marker.startMs) / 1000 / span) * 100}%`, minWidth: tv ? 28 : compact ? 12 : 28,
          backgroundColor: tv ? 'rgba(255,255,255,.46)' : '#edf5fa6b', borderLeftWidth: tv ? first ? 0 : 3 : 1.5, borderRightWidth: tv ? last ? 0 : 3 : 1.5, borderColor: tv ? 'rgba(4,9,13,.95)' : '#07101899'},
          first && {borderTopLeftRadius: tv ? track / 2 : 0, borderBottomLeftRadius: tv ? track / 2 : 0}, last && {borderTopRightRadius: tv ? track / 2 : 0, borderBottomRightRadius: tv ? track / 2 : 0}]}/>;
      })}
      {tv && preview !== undefined && <View style={{position: 'absolute', top: '50%', left: `${played * 100}%`, width: 4, height: 26, marginTop: -13, marginLeft: -2, borderRadius: 2, backgroundColor: 'rgba(237,245,250,.9)'}}/>}
      {tv
        ? <View style={{position: 'absolute', top: '50%', left: `${progress * 100}%`, width: knob, height: knob, marginTop: -knob / 2, marginLeft: -knob / 2, borderRadius: knob / 2,
            backgroundColor: theme.colors.white, boxShadow: ring ? `0 0 0 4px ${theme.colors.ink}, 0 0 0 8px ${theme.colors.focus}, 0 10px 40px 4px rgba(92,179,226,.45)` : '0 2px 10px rgba(0,0,0,.55)'}}/>
        : <Animated.View style={[{position: 'absolute', top: '50%', left: 0, width: knob, height: knob, marginTop: -knob / 2, marginLeft: -knob / 2, borderRadius: knob / 2,
            backgroundColor: theme.colors.white, boxShadow: '0 2px 10px rgba(0,0,0,.55)'}, knobPaint]}/>}
    </View>}
  </Focusable>;
  return <GestureDetector gesture={gesture}><View onLayout={event => {width.current = event.nativeEvent.layout.width; travel.value = event.nativeEvent.layout.width;}} style={{height: tv ? preview !== undefined ? 80 : 40 : 44, justifyContent: 'flex-start'}}>
    {tv && preview !== undefined && <NativeTrickplayStrip trickplay={source.options?.trickplay} seconds={preview} start={start} end={end}/>}
    {!tv && preview !== undefined && <View pointerEvents="none" style={{position: 'absolute', bottom: 44, left: `${Math.min(.9, Math.max(.1, progress)) * 100}%`, padding: 8, borderRadius: 6, backgroundColor: theme.colors.ink}}><Text style={[theme.type.caption, {color: theme.colors.text}]}>{clockText(preview)}</Text></View>}
    {tv && <View style={{height: 40, justifyContent: 'center'}}>{seek(40)}</View>}
    {tv && preview !== undefined && <View style={{height: 30, marginTop: 10}}>
      {span > 0 && marks.map(marker => {
        const at = Math.max(0, Math.min(1, (marker.startMs / 1000 - start) / span));
        return <View key={marker.id} pointerEvents="none" style={marker.type === 'credits' ? {position: 'absolute', top: 2, right: 0} : {position: 'absolute', top: 2, left: `${at * 100}%`}}>
          <Text numberOfLines={1} style={{fontFamily: 'Manrope-Bold', fontSize: 20, fontWeight: '700', color: theme.colors.textSecondary}}>{label(marker)}</Text>
        </View>;
      })}
    </View>}
    {!tv && seek(44)}
  </View></GestureDetector>;
}
