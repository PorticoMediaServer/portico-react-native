import React, {useMemo, useRef, useState} from 'react';
import {Image, PanResponder, View, type ImageSourcePropType} from 'react-native';
import {trickplayFrameAt, type TrickplaySet} from '../../../../packages/client-core/src/trickplay';
import {formatClock} from '../app/content';
import {Focusable, Text, alpha, useTheme} from '../ui';
import {activeI18n} from '../app/errors';
import {chapterAt, type PlayerChapter} from './engine-media';

/**
 * Scrubber. Handheld: drag anywhere on the track to preview and seek on
 * release. Television: the track is a single focusable element; the player
 * routes left/right presses to seek while it holds focus.
 *
 * Detected segments (an intro, a recap, the credits) are tinted on the track, as on the web.
 * Where the title has chapters the track carries a mark at each one, and while the viewer scrubs
 * a small card above the knob shows where they would land: the picture there (the server's scrub
 * previews, where it has made them), the chapter's name, and the time.
 */
export function Timeline({position, duration, pending, live, onSeek, focused, onFocusChange, hasTVPreferredFocus, programmeLabel, behindLabel, chapters, segments, trickplay, artwork, scrubbing}: {position: number; duration: number; pending?: number; live?: boolean; onSeek: (seconds: number) => void; focused?: boolean; onFocusChange?: (focused: boolean) => void; hasTVPreferredFocus?: boolean; /** MU4 FEAT-07: the programme's wall-clock times ("7:30 – 8:30 PM"). */ programmeLabel?: string; /** MU4 FEAT-07: how far behind live ("2:15 behind live"). */ behindLabel?: string;
  /** The title's chapters, in order. */ chapters?: readonly PlayerChapter[]; /** Detected segments to tint, in seconds. */ segments?: readonly Readonly<{start: number; end: number}>[]; /** The server's scrub previews for the title. */ trickplay?: TrickplaySet | null; /** An authorised image source for a server path. */ artwork?: (path?: string) => ImageSourcePropType | undefined; /** Television: the viewer is scrubbing (the remote's surface), so the card shows. */ scrubbing?: boolean}) {
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
  // A mark at each chapter's start (never at the very start or end, and never for a channel).
  const marks = useMemo(() => (live || duration <= 0 || !chapters || chapters.length < 2 ? [] : chapters.map(c => c.startSeconds).filter(at => at > 1 && at < duration - 1).slice(0, 200)), [chapters, duration, live]);
  const tints = useMemo(() => (live || duration <= 0 || !segments ? [] : segments.filter(t => t.end > t.start && t.start < duration).slice(0, 64)), [segments, duration, live]);
  // The card over the knob: while a finger drags the track, or the remote's surface scrubs.
  const cardAt = !live && duration > 0 ? (preview ?? (scrubbing ? pending : undefined)) : undefined;
  const frame = cardAt !== undefined && trickplay ? trickplayFrameAt(trickplay, cardAt) : null;
  const tile = frame ? artwork?.(frame.tileUrl) : undefined;
  const chapter = cardAt !== undefined && chapters && chapters.length > 1 ? chapterAt(chapters, cardAt) : undefined;
  const cardWidth = isTV ? 320 : 160;
  const scale = frame ? cardWidth / frame.width : 1;
  const card = cardAt !== undefined && width > 0 && (tile || chapter?.title) ? (
    <View pointerEvents="none" style={{position: 'absolute', bottom: (isTV ? 64 : 32) + space.xs, left: Math.max(0, Math.min(width - cardWidth, ratio * width - cardWidth / 2)), width: cardWidth, alignItems: 'center', gap: space.xs}}>
      {tile && frame && trickplay ? (
        <View style={{width: cardWidth, height: frame.height * scale, overflow: 'hidden', borderRadius: metrics.radius.small, borderWidth: 1, borderColor: alpha(colors.white, 0.35), backgroundColor: colors.black}}>
          <Image source={tile} accessibilityIgnoresInvertColors style={{position: 'absolute', left: -frame.x * scale, top: -frame.y * scale, width: trickplay.width * scale, height: trickplay.height * scale}} />
        </View>
      ) : null}
      {chapter?.title ? <Text variant="micro" lines={1} style={{textShadowColor: colors.black, textShadowRadius: 4}}>{chapter.title}</Text> : null}
    </View>
  ) : null;
  const track = (
    <View
      onLayout={e => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
      style={{height: isTV ? 64 : 32, justifyContent: 'center'}} /* QA: a 64 pt focus target on TV */
      {...(isTV ? {} : {...responder.panHandlers, accessible: true, accessibilityRole: 'adjustable' as const, accessibilityLabel: activeI18n().t('player.position'), accessibilityValue: {text: formatClock(shown)}, ...accessibility})}>
      <View style={{height: trackHeight, borderRadius: trackHeight / 2, backgroundColor: alpha(colors.white, 0.28), overflow: 'hidden'}}>
        {tints.map(t => <View key={`${t.start}:${t.end}`} pointerEvents="none" style={{position: 'absolute', left: (t.start / duration) * width, width: Math.max(2, ((t.end - t.start) / duration) * width), top: 0, height: trackHeight, backgroundColor: alpha(colors.white, 0.18)}} />)}
        <View style={{width: `${ratio * 100}%`, height: '100%', backgroundColor: live ? colors.record : colors.accent}} />
        {marks.map(at => <View key={at} pointerEvents="none" style={{position: 'absolute', left: (at / duration) * width - 1, top: 0, width: 2, height: trackHeight, backgroundColor: alpha(colors.black, 0.6)}} />)}
      </View>
      {duration > 0 ? <View pointerEvents="none" style={{position: 'absolute', left: Math.max(0, ratio * width - knob / 2), width: knob, height: knob, borderRadius: knob / 2, backgroundColor: colors.white, transform: [{scale: focused || preview !== undefined ? 1.5 : 1}], shadowColor: colors.black, shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: {width: 0, height: 2}}} /> : null}
    </View>
  );
  return (
    <View style={{gap: space.xs}}>
      {card}
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
