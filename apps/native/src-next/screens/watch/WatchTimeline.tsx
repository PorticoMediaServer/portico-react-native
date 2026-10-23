import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {sameFence} from '../../../../../packages/player-core/src';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativePlaybackRuntimeSnapshot} from '../../platform/playback/types';
import type {NativeShellPlaybackAdapter} from '../../shell/playback';
import {Focusable} from '../../kit/controls';
import {useTheme} from '../../kit/theme';
import type {NativeWatchControls} from './controls';

type Props = Readonly<{
  source: NativePlaybackRuntimeSnapshot;
  controls: NativeWatchControls;
  playback: Pick<NativeShellPlaybackAdapter, 'getSnapshot' | 'seek'>;
  compact: boolean;
  enabled: boolean;
  reportError: (error: unknown) => void;
  skipBackSeconds: number;
  skipForwardSeconds: number;
}>;

/** Actual time/window only. Scrub commits on lift; absent trickplay never becomes invented imagery. */
export function NativeWatchTimeline({source, playback, controls, compact, enabled, reportError, skipBackSeconds, skipForwardSeconds}: Props) {
  const theme = useTheme(), fence = source.fence, width = useRef(0), dragging = useRef(false);
  const [preview, setPreview] = useState<number>();
  const start = source.seekWindow?.startSeconds ?? 0, end = source.seekWindow?.endSeconds ?? source.playback.duration;
  const span = end - start;
  const current = useCallback(() => !!fence && sameFence(playback.getSnapshot().fence, fence) && !source.retired, [fence, playback, source.retired]);
  useEffect(() => {dragging.current = false; setPreview(undefined);}, [fence]);
  const target = useCallback((x: number) => width.current > 0 && span > 0 ? Math.max(start, Math.min(end, start + x / width.current * span)) : undefined, [start, end, span]);
  const gesture = useMemo(() => Gesture.Pan().enabled(enabled && source.capabilities.seek).minDistance(0).runOnJS(true)
    .onBegin(event => {if (!fence || !current()) return; dragging.current = true; controls.scrub(fence, true); setPreview(target(event.x));})
    .onUpdate(event => {if (dragging.current && current()) setPreview(target(event.x));})
    .onEnd(event => {
      const seconds = target(event.x);
      if (fence && dragging.current && current() && seconds !== undefined) void playback.seek(fence, seconds).catch(reportError);
    }).onFinalize(() => {dragging.current = false; setPreview(undefined); if (fence) controls.scrub(fence, false);}),
    [enabled, fence, source.capabilities.seek, playback, controls, reportError, current, target]);
  const position = preview ?? source.playback.positionSeconds, progress = span > 0 ? Math.max(0, Math.min(1, (position - start) / span)) : 0;
  const markers = source.options?.itemId === (fence?.kind === 'queue' ? fence.itemId : undefined) ? source.options?.markers ?? [] : [];
  const marks = markers.filter(marker => ['intro', 'recap', 'credits'].includes(marker.type) && marker.endMs > marker.startMs && marker.startMs / 1000 < end && marker.endMs / 1000 > start);
  const adjust = (seconds: number) => {if (fence && current()) void playback.seek(fence, Math.max(start, Math.min(end, position + seconds))).catch(reportError);};
  return <GestureDetector gesture={gesture}><View onLayout={event => {width.current = event.nativeEvent.layout.width;}} style={{height: 44, justifyContent: 'center'}}>
    {preview !== undefined && <View pointerEvents="none" style={{position: 'absolute', bottom: 44, left: `${Math.min(.9, Math.max(.1, progress)) * 100}%`, padding: 8, borderRadius: 6, backgroundColor: theme.colors.ink}}><Text style={[theme.type.caption, {color: theme.colors.text}]}>{clockText(preview)}</Text></View>}
    <Focusable accessibilityRole="adjustable" accessibilityLabel={defaultI18n.t('player.position')} accessibilityValue={{min: start, max: Math.max(start, end), now: Math.max(start, Math.min(end, position))}}
      focusId="watch-seek" testID="watch-seek" focusable={enabled} disabled={!enabled || !source.capabilities.seek}
      accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]} onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'increment') adjust(skipForwardSeconds); else if (event.nativeEvent.actionName === 'decrement') adjust(-skipBackSeconds);}}
      style={{height: 44, justifyContent: 'center'}}>
      <View pointerEvents="none" style={{height: compact ? 3 : theme.isTV ? 8 : 4, backgroundColor: '#edf5fa33', borderRadius: compact ? 0 : 4}}>
        <View style={{position: 'absolute', top: 0, bottom: 0, left: 0, width: `${progress * 100}%`, backgroundColor: theme.colors.accentStrong}}/>
        {span > 0 && marks.map(marker => <View key={marker.id} style={{position: 'absolute', top: 0, bottom: 0, left: `${Math.max(0, (marker.startMs / 1000 - start) / span) * 100}%`, width: `${Math.min(1, (marker.endMs - marker.startMs) / 1000 / span) * 100}%`, minWidth: compact ? 12 : 28, backgroundColor: '#edf5fa6b', borderLeftWidth: 1.5, borderRightWidth: 1.5, borderColor: '#07101899'}}/>)}
        <View style={{position: 'absolute', left: `${progress * 100}%`, top: (compact ? 3 : theme.isTV ? 8 : 4) / 2 - 7, marginLeft: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.white}}/>
      </View>
    </Focusable>
  </View></GestureDetector>;
}
