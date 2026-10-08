import React, {useMemo, useRef, useState} from 'react';
import {PanResponder, View} from 'react-native';
import {formatClock} from '../app/content';
import {Focusable, Text, alpha, useTheme} from '../ui';
import {activeI18n} from '../app/errors';

/**
 * Scrubber. Handheld: drag anywhere on the track to preview and seek on
 * release. Television: the track is a single focusable element; the player
 * routes left/right presses to seek while it holds focus.
 */
export function Timeline({position, duration, pending, live, onSeek, focused, onFocusChange, hasTVPreferredFocus, programmeLabel, behindLabel}: {position: number; duration: number; pending?: number; live?: boolean; onSeek: (seconds: number) => void; focused?: boolean; onFocusChange?: (focused: boolean) => void; hasTVPreferredFocus?: boolean; /** MU4 FEAT-07: the programme's wall-clock times ("7:30 – 8:30 PM"). */ programmeLabel?: string; /** MU4 FEAT-07: how far behind live ("2:15 behind live"). */ behindLabel?: string}) {
  const {colors, space, isTV, metrics} = useTheme();
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number>();
  const widthRef = useRef(0);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const shown = preview ?? pending ?? position;
  const ratio = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !isTV && durationRef.current > 0,
        onMoveShouldSetPanResponder: () => !isTV && durationRef.current > 0,
        onPanResponderGrant: e => setPreview(Math.max(0, Math.min(1, e.nativeEvent.locationX / Math.max(1, widthRef.current))) * durationRef.current),
        onPanResponderMove: e => setPreview(Math.max(0, Math.min(1, e.nativeEvent.locationX / Math.max(1, widthRef.current))) * durationRef.current),
        onPanResponderRelease: e => {
          const target = Math.max(0, Math.min(1, e.nativeEvent.locationX / Math.max(1, widthRef.current))) * durationRef.current;
          setPreview(undefined);
          onSeek(target);
        },
        onPanResponderTerminate: () => setPreview(undefined),
      }),
    [isTV, onSeek],
  );
  // VoiceOver and Switch Control adjust the timeline with increment/decrement (10 seconds each).
  const accessibility = {
    accessibilityActions: [{name: 'increment' as const}, {name: 'decrement' as const}],
    onAccessibilityAction: (e: {nativeEvent: {actionName: string}}) => {
      if (duration <= 0) return;
      const step = e.nativeEvent.actionName === 'increment' ? 10 : e.nativeEvent.actionName === 'decrement' ? -10 : 0;
      if (step) onSeek(Math.max(0, Math.min(duration, shown + step)));
    },
  };
  const trackHeight = isTV ? 8 : 4;
  const knob = isTV ? 22 : 14;
  const track = (
    <View
      onLayout={e => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
      style={{height: isTV ? 64 : 32, justifyContent: 'center'}} /* QA: a 64 pt focus target on TV */
      {...(isTV ? {} : {...responder.panHandlers, accessible: true, accessibilityRole: 'adjustable' as const, accessibilityLabel: activeI18n().t('player.position'), accessibilityValue: {text: formatClock(shown)}, ...accessibility})}>
      <View style={{height: trackHeight, borderRadius: trackHeight / 2, backgroundColor: alpha(colors.white, 0.28), overflow: 'hidden'}}>
        <View style={{width: `${ratio * 100}%`, height: '100%', backgroundColor: live ? colors.record : colors.accent}} />
      </View>
      {duration > 0 ? <View pointerEvents="none" style={{position: 'absolute', left: Math.max(0, ratio * width - knob / 2), width: knob, height: knob, borderRadius: knob / 2, backgroundColor: colors.white, transform: [{scale: focused || preview !== undefined ? 1.5 : 1}], shadowColor: colors.black, shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: {width: 0, height: 2}}} /> : null}
    </View>
  );
  return (
    <View style={{gap: space.xs}}>
      {isTV ? (
        <Focusable accessibilityRole="adjustable" accessibilityLabel={activeI18n().t('player.position')} accessibilityValue={{text: formatClock(shown)}} {...accessibility} radius={metrics.radius.small} scale={1} hasTVPreferredFocus={hasTVPreferredFocus} onFocus={() => onFocusChange?.(true)} onBlur={() => onFocusChange?.(false)}>
          {track}
        </Focusable>
      ) : (
        track
      )}
      <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
        <Text variant="micro" tone="secondary" style={{fontVariant: ['tabular-nums']}}>{programmeLabel ?? formatClock(shown)}</Text>
        {live ? <Text variant="micro" tone="danger">{behindLabel ? `${behindLabel} · ` : ''}{activeI18n().t('player.liveBadge')}</Text> : <Text variant="micro" tone="secondary" style={{fontVariant: ['tabular-nums']}}>{duration > 0 ? `-${formatClock(Math.max(0, duration - shown))}` : '--:--'}</Text>}
      </View>
    </View>
  );
}
