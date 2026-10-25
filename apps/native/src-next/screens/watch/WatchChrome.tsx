import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Text, View, useTVEventHandler} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {cancelAnimation, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import Svg, {Defs, LinearGradient, Path, Rect, Stop, Text as SvgText} from 'react-native-svg';
import {sameFence, activeSegment, skipTarget, skipsAutomatically, followedByScene, UNDO_SECONDS, type PlaybackFence, type SegmentMarker, type SegmentMarkerKind, type SkipMode} from '../../../../../packages/player-core/src';
import {upNextCountdown, upNextOffer} from '../../../../../packages/client-core/src/up-next';
import {channelSeconds} from '../../../../../packages/client-core/src/playback/linear-protocol';
import {playbackIdentity, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativePlaybackRuntimeSnapshot} from '../../platform/playback/types';
import type {NativeShellPlaybackAdapter} from '../../shell/playback';
import {Button, Focusable} from '../../kit/controls';
import {FocusRegion, useFocusRegistry} from '../../kit/focus';
import {Icon, type IconName} from '../../kit/Icon';
import {NativeTVGroupPill} from '../settings-live/GroupPill';
import {nativeType, useTheme} from '../../kit/theme';
import {useMotion, useReducedMotion} from '../../kit/useMotion';
import {NativeWatchControls, type NativeWatchPanel} from './controls';
import {NativeWatchTimeline} from './WatchTimeline';
import {NativeUpNextCard} from './UpNextCard';
import {Artwork, type ArtworkSource} from '../../kit/artwork';
import type {NativeWatchNotice} from './playback-info';

export type NativeWatchChromeProps = Readonly<{
  source: NativePlaybackRuntimeSnapshot;
  controls: NativeWatchControls;
  playback: Pick<NativeShellPlaybackAdapter, 'getSnapshot' | 'toggle' | 'skip' | 'seek' | 'previous' | 'next' | 'goLive'>;
  text: TextEnvironment;
  /** Delivered by the current-fence producers, never the first/default offer or a policy ceiling. */
  quality: string;
  audio?: string;
  subtitle?: string;
  /** Actual physical picture pane; centre transport is centred inside it, including book mode. */
  width: number;
  height: number;
  compact: boolean;
  /** An expanded-size-class device (iPad): tablet-play3 draws an 84 pt centre button. */
  tablet?: boolean;
  /** Book-mode edge chrome avoids the padded crease; centre transport does not move. */
  edgeInsets?: Readonly<{left?: number; right?: number}>;
  skipBackSeconds: number;
  skipForwardSeconds: number;
  onMinimize: (fence: PlaybackFence) => void;
  /** Live TV's Guide leaves the player for the guide. */
  onGuide?: () => void;
  /** Channels only: return the same session to the live edge. */
  goLive?: (fence: PlaybackFence) => void;
  /** The viewer's Settings choice per segment kind; the engine already applies `auto`. */
  skipModes: Readonly<Record<'intro' | 'recap' | 'credits', SkipMode>>;
  /** The current authority's artwork resolver, for the next episode's still. */
  artwork?: (path?: string) => ArtworkSource | undefined;
  onPanel?: (panel: NativeWatchPanel, fence: PlaybackFence) => void;
  /** TV4 keeps only identity/seek dimmed behind the authored overlay. */
  tvPanelRight?: number;
  reportError: (error: unknown) => void;
  onPictureInPicture?: (fence: PlaybackFence) => void;
  onCast?: (fence: PlaybackFence) => void;
  onFullWindow?: (fence: PlaybackFence) => void;
  /** tv-player/phone-player 5 and 13: the committed plan's one loss note, once per playback. */
  notice?: Readonly<{key: string; value: NativeWatchNotice; shownAt: number}>;
}>;

const NOTICE_SECONDS = 6;
/** tv-player/phone-player 5 and 13: one quiet line, once per playback, that never
 * takes focus and clears the top row. The plan's own words, not a code. */
function LossNotice({notice, top, gutter}: {notice: NonNullable<NativeWatchChromeProps['notice']>; top: number; gutter: number}) {
  const theme = useTheme(), reduced = useReducedMotion(), line = useSharedValue(1);
  const [expired, setExpired] = useState<string | undefined>(undefined);
  useEffect(() => {
    setExpired(undefined);
    line.value = 1;
    line.value = withTiming(0, {duration: reduced ? 0 : NOTICE_SECONDS * 1000});
    const timer = setTimeout(() => setExpired(notice.key), NOTICE_SECONDS * 1000);
    return () => {clearTimeout(timer); cancelAnimation(line);};
  }, [notice.key, line, reduced]);
  const drain = useAnimatedStyle(() => ({width: `${line.value * 100}%`}));
  if (expired === notice.key) return null;
  const phone = !theme.isTV;
  return <View pointerEvents="none" accessibilityLiveRegion="polite" accessibilityRole="alert" testID="watch-loss-notice"
    style={{position: 'absolute', top, right: gutter, maxWidth: phone ? 320 : 560, borderRadius: phone ? 12 : 20, overflow: 'hidden',
      paddingLeft: phone ? 12 : 20, paddingRight: phone ? 14 : 26, paddingTop: phone ? 9 : 14, paddingBottom: phone ? 11 : 18,
      backgroundColor: 'rgba(9,19,27,.82)', boxShadow: `inset 0 0 0 1px rgba(237,245,250,.1), 0 18px 40px -18px rgba(0,0,0,.85)`}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: phone ? 9 : 14}}>
      <Icon name={notice.value.icon === 'picture' ? 'i-film' : 'i-audio'} size={phone ? 16 : 24} color={theme.colors.textSecondary}/>
      <Text style={[nativeType({size: phone ? 13.5 : 24, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {flexShrink: 1, color: theme.colors.text}]}>{notice.value.message}</Text>
    </View>
    {!reduced && <View style={{marginTop: phone ? 7 : 10, height: 2, borderRadius: 1, overflow: 'hidden', backgroundColor: 'rgba(237,245,250,.18)'}}>
      <Animated.View style={[{height: 2, backgroundColor: theme.colors.accentStrong}, drain]}/>
    </View>}
  </View>;
}

function SkipIcon({seconds, forward, size, color}: {seconds: number; forward?: boolean; size: number; color: string}) {
  return <Svg width={size} height={size} color={color} viewBox="0 0 32 32" accessible={false}>
    <Path d={forward ? 'M25 10a11 11 0 1 1-8-4M25 3v7h-7' : 'M7 10a11 11 0 1 0 8-4M7 3v7h7'} stroke="currentColor" strokeWidth={2.3} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    <SvgText x={16} y={23} textAnchor="middle" fontFamily="Manrope-Bold" fontSize={11} fill="currentColor">{seconds}</SvgText>
  </Svg>;
}

/** Portico controls over the shell's one retained surface. This component owns no video view. */
export function NativeWatchChrome(props: NativeWatchChromeProps) {
  const {source, controls, playback, width, height, compact} = props;
  const t = defaultI18n.t;
  const wallClock = (atMs: number) => new Intl.DateTimeFormat(props.text.locale, {hour: 'numeric', minute: '2-digit'}).format(new Date(atMs));
  const theme = useTheme(), motion = useMotion(), state = useSyncExternalStore(controls.subscribe, controls.getSnapshot);
  const registry = useFocusRegistry();
  useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  const focus = registry.capture();
  const opacity = useSharedValue(0), toggle = useRef<View>(null), picture = useRef<View>(null);
  const [landing, setLanding] = useState<number>(), [returnAt, setReturnAt] = useState(0), [now, setNow] = useState(() => Date.now());
  const fence = source.fence;
  const current = useCallback(() => !!fence && !source.retired && sameFence(playback.getSnapshot().fence, fence) && sameFence(state.fence, fence), [fence, source.retired, playback, state.fence]);
  const visible = current() && state.visible;
  // tablet-play4: a swipe down on the picture minimises to the dock, the same
  // thing the chevron does. Taps, horizontal seeks and the equalizer keep
  // their own gestures; this one only starts on a clear downward drag.
  const swipeLive = useRef({current, panel: state.panel, fence, minimize: props.onMinimize});
  swipeLive.current = {current, panel: state.panel, fence, minimize: props.onMinimize};
  const minimizeSwipe = useMemo(() => Gesture.Pan().enabled(!theme.isTV).runOnJS(true).activeOffsetY(24).failOffsetX([-48, 48])
    .onEnd(event => {const live = swipeLive.current;
      if (event.translationY > 64 && Math.abs(event.translationX) < 64 && live.fence && !live.panel && live.current()) live.minimize(live.fence);}), [theme.isTV]);
  const seekFocused = theme.isTV && visible && !state.panel && focus?.regionId === 'watch-controls' && focus.childId === 'watch-seek';
  // tv-player 3: the prompt offers the segment the viewer is in, and an unattended
  // skip leaves a six-second note whose Undo goes back to where the skip happened.
  const markers = source.options?.itemId === (fence?.kind === 'queue' ? fence.itemId : undefined) ? source.options?.markers ?? [] : [];
  const segments: readonly SegmentMarker[] = markers.flatMap(marker => marker.type === 'intro' || marker.type === 'recap' || marker.type === 'credits'
    ? [{id: marker.id, kind: marker.type, startSeconds: marker.startMs / 1000, endSeconds: marker.endMs / 1000, automaticSafe: marker.automaticSafe}] : []);
  const dismissed = useRef<Set<string>>(new Set());
  const [notice, setNotice] = useState<{kind: SegmentMarkerKind; fromSeconds: number}>();
  const seen = useRef(source.playback.positionSeconds), undoLine = useSharedValue(1);
  useEffect(() => {
    const at = source.playback.positionSeconds, from = seen.current;
    seen.current = at;
    if (at === from) return;
    const skipped = segments.find(marker => skipsAutomatically(marker, props.skipModes) && from >= marker.startSeconds && from < marker.endSeconds
      && at >= skipTarget(marker, source.playback.duration) - .5);
    if (!skipped) return;
    dismissed.current.add(skipped.id);
    setNotice({kind: skipped.kind, fromSeconds: from});
  }, [source.playback.positionSeconds, source.playback.duration, segments, props.skipModes]);
  useEffect(() => {
    if (!notice) return;
    undoLine.value = 1;
    undoLine.value = withTiming(0, {duration: UNDO_SECONDS * 1000});
    const timer = setTimeout(() => setNotice(undefined), UNDO_SECONDS * 1000);
    return () => {clearTimeout(timer); cancelAnimation(undoLine);};
  }, [notice, undoLine]);
  const undoLineStyle = useAnimatedStyle(() => ({width: `${undoLine.value * 100}%`}));
  // tv-player 5 and 6: the closing-credits offer and its countdown come from the
  // queue's own post-play facts; nothing here starts a title by itself.
  const view = source.queue.view;
  const currentItem = view?.current ? view.items.find(item => item.entryId === view.current!.id) : undefined;
  const nextItem = view?.next.entryId ? view.items.find(item => item.entryId === view.next.entryId) : undefined;
  const credits = segments.find(segment => segment.kind === 'credits');
  const sceneAfter = !!credits && followedByScene(credits, source.playback.duration);
  const offer = fence && fence.kind === 'queue' && view ? upNextOffer({markers: segments, positionSeconds: source.playback.positionSeconds,
    durationSeconds: source.playback.duration, kind: currentItem?.kind ?? source.entry?.kind, mode: props.skipModes.credits, nextAvailable: view.next.available, passoutDue: view.postPlay.passoutCheckDue}) : null;
  const [, tick] = useState(0), dismissedOffer = useRef<string | undefined>(undefined), offerId = useRef<string | undefined>(undefined), offerSince = useRef(Date.now());
  useEffect(() => {if (!offer) return; if (offerId.current !== offer.id) {offerId.current = offer.id; offerSince.current = Date.now();}}, [offer?.id]);
  const countdown = offer && view ? upNextCountdown({offer, positionSeconds: source.playback.positionSeconds, durationSeconds: source.playback.duration,
    rate: source.effectiveRate, autoplay: view.postPlay.autoplay, countdownSeconds: view.postPlay.countdownSeconds,
    elapsedSeconds: (Date.now() - offerSince.current) / 1000, startDuringCredits: view.postPlay.startDuringCredits}) : null;
  useEffect(() => {if (!countdown?.automatic) return; const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer);}, [countdown?.automatic]);
  useEffect(() => {
    if (!seekFocused) {setLanding(undefined); return;}
    setReturnAt(source.playback.positionSeconds);
  }, [seekFocused]); // The return point is where the viewer was when the bar took focus.
  useEffect(() => {
    if (!theme.isTV || !visible) return;
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, [theme.isTV, visible]);
  useEffect(() => {
    // motion.html 2.6/4.5: controls enter standard, timer exit slow; no geometry animation here.
    opacity.value = withTiming(visible ? 1 : 0, motion.timing(visible || state.hideReason !== 'timer' ? 'standard' : 'slow'));
    return () => cancelAnimation(opacity);
  }, [visible, motion, opacity, state.hideReason]);
  const fade = useAnimatedStyle(() => ({opacity: opacity.value}));
  useEffect(() => {
    if (!theme.isTV || !fence || !current() || state.panel) return;
    const node = visible ? toggle.current : picture.current;
    node?.requestTVFocus?.();
  }, [visible, fence, theme.isTV, current, state.panel]); // The native focus engine owns movement inside the region.
  useTVEventHandler(event => {
    if (!theme.isTV || !fence || !current() || source.dock.local?.expanded !== true || state.panel || event.eventKeyAction === 1) return;
    if (['up', 'down', 'left', 'right', 'select', 'longLeft', 'longRight'].includes(event.eventType)) {
      if (!controls.key(fence)) controls.reveal(fence);
    }
  });
  if (!fence || !current() || source.dock.local?.expanded !== true) return null;
  const act = (command: (expected: PlaybackFence) => Promise<void>) => {if (current()) {controls.reveal(fence); void command(fence).catch(props.reportError);}};
  // A phone keeps offering Skip and Up next while its controls are down (phone-player 2 and 6).
  const offered = (visible || !theme.isTV) && !state.panel && !notice ? activeSegment(segments, source.playback.positionSeconds, props.skipModes, dismissed.current) : undefined;
  const prompt = offered && (offered.kind === 'intro' || offered.kind === 'recap' || offered.kind === 'credits') && props.skipModes[offered.kind] === 'ask' ? offered : undefined;
  const visibleOffer = (visible || !theme.isTV) && !state.panel && !notice && offer && nextItem && offer.id !== dismissedOffer.current ? offer : undefined;
  const skipSegment = (marker: SegmentMarker) => {dismissed.current.add(marker.id); setNotice(undefined); if (current()) void playback.seek(fence, skipTarget(marker, source.playback.duration)).catch(props.reportError);};
  const panel = (value: NativeWatchPanel) => {if (current() && controls.open(value, fence)) props.onPanel?.(value, fence);};
  const identity = source.subject ? playbackIdentity(source.subject, 'full', props.text) : undefined;
  const queue = fence.kind === 'queue' && (source.queue.view?.items.length ?? 0) > 1;
  // tv-player 11: a channel is the normal player with the guide's programme in it.
  const linear = fence?.kind === 'channel' ? source.playback.linear : undefined;
  const liveEdge = linear ? channelSeconds(linear.media.liveEdgeUs) : undefined;
  const behindLive = liveEdge === undefined ? 0 : Math.max(0, liveEdge - source.playback.positionSeconds);
  const audioTracks = source.options?.versions.find(version => version.id === source.session?.versionId)?.audio.length ?? source.options?.versions[0]?.audio.length ?? 0;
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 3).map(word => word[0]!.toUpperCase()).join('');
  const channelMark = linear ? (linear.media.logoUrl
    ? <Artwork source={props.artwork?.(linear.media.logoUrl)} width={64} height={64} style={{borderRadius: 15, overflow: 'hidden', marginRight: 24}}/>
    : <View style={{width: 64, height: 64, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 24, backgroundColor: theme.colors.accentDeep}}>
        <Text style={{fontFamily: 'Manrope-ExtraBold', fontSize: 21, fontWeight: '800', color: '#fff'}}>{initials(linear.name)}</Text></View>) : null;
  if (theme.isTV && state.panel && props.tvPanelRight !== undefined) return <View testID="watch-tv-panel-backdrop" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{width, height}}>
    {identity && <View style={{position: 'absolute', left: 96, right: props.tvPanelRight, top: 80}}>
      <Text numberOfLines={1} style={[nativeType({size: 44, weight: 800, tracking: -.015, lineHeight: 52}, theme.textScale), {color: theme.colors.text}]}>{identity.title}</Text>
      <Text numberOfLines={1} style={[theme.type.bodyStrong, {fontSize: 24, color: theme.colors.textSecondary}]}>{identity.subtitle.map(part => part.text).join(' ')}</Text>
    </View>}
    <View style={{position: 'absolute', left: 96, right: props.tvPanelRight, bottom: 118}}>
      <NativeWatchTimeline source={source} controls={controls} playback={playback} compact={false} enabled={false} tv reportError={props.reportError} skipBackSeconds={props.skipBackSeconds} skipForwardSeconds={props.skipForwardSeconds}/>
    </View>
    <View style={{position: 'absolute', left: 96, right: props.tvPanelRight, bottom: 80, flexDirection: 'row', justifyContent: 'space-between'}}>
      <Text style={[theme.type.bodyStrong, {fontSize: 24, color: theme.colors.textSecondary}]}>{clockText(source.playback.positionSeconds)}</Text>
      <Text style={[theme.type.bodyStrong, {fontSize: 24, color: theme.colors.textSecondary}]}>{clockText(Math.max(0, source.playback.duration - source.playback.positionSeconds))}</Text>
    </View>
    <View style={{position: 'absolute', inset: 0, backgroundColor: '#04090d80'}}/>
  </View>;
  const tablet = props.tablet === true;
  const big = theme.isTV ? 88 : compact ? (tablet ? 84 : 58) : 74, small = theme.isTV ? 64 : compact ? 46 : 58;
  const icon = (id: string, name: IconName, label: string, onPress: () => void, primary = false, disabled = false, size?: number) => <Button focusId={`watch-${id}`} testID={`watch-${id}`} variant={primary ? 'primary' : theme.isTV ? 'icon' : 'text'} iconOnly icon={name} accessibilityLabel={label}
    focusable={visible} disabled={disabled || !visible} onPress={onPress} style={{width: size ?? (primary ? big : small), height: size ?? (primary ? big : small), borderRadius: (size ?? (primary ? big : small)) / 2}}
    iconSize={size ? Math.round(size * .6) : primary ? theme.isTV ? 40 : 28 : theme.isTV ? 26 : 22}/>;
  const skip = (forward: boolean) => <Focusable focusId={forward ? 'watch-skip-forward' : 'watch-skip-back'} testID={forward ? 'watch-skip-forward' : 'watch-skip-back'} focusable={visible} disabled={!visible || !source.capabilities.seek} accessibilityRole="button"
    accessibilityLabel={t(forward ? 'player.skipForwardSeconds' : 'player.skipBackSeconds', {seconds: forward ? props.skipForwardSeconds : props.skipBackSeconds})}
    onPress={() => act(expected => playback.skip(expected, forward ? props.skipForwardSeconds : -props.skipBackSeconds))}
    style={{width: small, height: small, alignItems: 'center', justifyContent: 'center', opacity: source.capabilities.seek ? 1 : .4}}>
    <SkipIcon color={theme.colors.text} forward={forward} seconds={forward ? props.skipForwardSeconds : props.skipBackSeconds} size={theme.isTV ? 36 : compact ? 30 : 38}/>
  </Focusable>;
  const option = (name: NativeWatchPanel, label: string, value?: string) => <Focusable focusId={`watch-option-${name}`} testID={`watch-option-${name}`} accessibilityRole="button" focusable={visible} disabled={!visible} onPress={() => panel(name)} style={{minHeight: theme.isTV ? 64 : 36, paddingHorizontal: theme.isTV ? 16 : 12, paddingVertical: theme.isTV ? 10 : 6, justifyContent: 'center', borderRadius: theme.isTV ? 12 : 8, backgroundColor: theme.colors.raisedHigh}}>
    {theme.isTV ? <><Text style={{fontFamily: theme.type.bodyStrong.fontFamily, fontSize: 20, color: theme.colors.text}}>{label}</Text>{value && <Text style={{fontFamily: theme.type.body.fontFamily, fontSize: 17, color: theme.colors.textSecondary}}>{value}</Text>}</> : <Text style={[theme.type.caption, {color: theme.colors.text}]}>{value ? label ? `${label} ${value}` : value : label}</Text>}
  </Focusable>;
  // phone-player 1: the pill row — Episodes, Subtitles, Audio and the Quality chip that
  // shows the current choice, last on the right.
  const chip = (name: NativeWatchPanel, icon: IconName, label: string, value: string | undefined, onPress?: () => void) => <Focusable key={`${name}:${label}`}
    focusId={onPress ? `watch-chip-${name}` : `watch-option-${name}`} testID={onPress ? `watch-chip-${name}` : `watch-option-${name}`} accessibilityRole="button" focusable={visible} disabled={!visible}
    onPress={() => {if (onPress) onPress(); else panel(name);}} style={{height: 36, paddingLeft: 11, paddingRight: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 7,
      backgroundColor: 'rgba(237,245,250,.14)'}}>
    <Icon name={icon} size={18} color={theme.colors.textSecondary}/>
    {!!label && <Text style={{fontFamily: 'Manrope-Bold', fontSize: 13.5, fontWeight: '700', color: theme.colors.text}}>{label}</Text>}
    {!!value && <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 13.5, fontWeight: '600', marginLeft: label ? 3 : 0, color: label ? theme.colors.textTertiary : theme.colors.text}}>{value}</Text>}
  </Focusable>;
  const qualityChip = (small = false) => <Focusable focusId="watch-option-quality" testID="watch-option-quality" accessibilityRole="button" focusable={visible} disabled={!visible}
    onPress={() => panel('quality')} style={small ? {height: 28, paddingLeft: 8, paddingRight: 10, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(237,245,250,.16)'}
      : {height: 36, paddingLeft: 11, paddingRight: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(237,245,250,.14)'}}>
    <Icon name="i-quality" size={small ? 16 : 18} color={theme.colors.textSecondary}/>
    <Text style={{fontFamily: 'Manrope-Bold', fontSize: small ? 12.5 : 13.5, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums']}}>{props.quality || t('player.opt.quality')}</Text>
  </Focusable>;
  const keycap = (label: string, icons?: IconName[]) => <View style={{minWidth: 44, height: 36, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, borderColor: 'rgba(237,245,250,.3)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2}}>
    {icons ? icons.map(name => <Icon key={name} name={name} size={20} color={theme.colors.textSecondary}/>) : <Text style={{fontFamily: 'Manrope-ExtraBold', fontSize: 17, fontWeight: '800', color: theme.colors.textSecondary}}>{label}</Text>}
  </View>;
  const hint = (index: number, cap: React.ReactNode, text: string) => <View key={text} style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: index ? 26 : 0}}>{cap}
    <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 20, fontWeight: '600', color: theme.colors.textTertiary}}>{text}</Text></View>;
  const transport = <View style={{flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 20 : compact ? 12 : 38}}>
    {queue && icon('previous', 'i-prev', t('player.previous'), () => act(playback.previous), false, !source.capabilities.previous, theme.isTV || compact ? undefined : 46)}
    {skip(false)}
    <Button ref={toggle} testID="watch-toggle" focusId="watch-toggle" variant="primary" iconOnly icon={source.playback.intent === 'playing' ? 'i-pause' : 'i-play'}
      accessibilityLabel={t(source.playback.intent === 'playing' ? 'action.pause' : 'action.play')} hasTVPreferredFocus={theme.isTV && visible}
      focusable={visible} disabled={!visible || !source.capabilities.play && !source.capabilities.pause} onPress={() => act(playback.toggle)}
      style={{width: big, height: big, borderRadius: big / 2}} iconSize={theme.isTV ? 40 : compact && tablet ? 34 : 28}/>
    {skip(true)}
    {queue && icon('next', 'i-next', t('player.next'), () => act(playback.next), false, !source.capabilities.next, theme.isTV || compact ? undefined : 46)}
  </View>;
  // tv-player 3 / phone-player 2: the same prompt, notice and offer on a phone,
  // where the controls may be down and the note's line rides its bottom edge.
  const phone = !theme.isTV;
  const skipOfferNode = visibleOffer && nextItem ? <NativeUpNextCard compact={phone} item={nextItem} artwork={props.artwork?.(nextItem.stillUrl ?? nextItem.backdropUrl)} offer={visibleOffer}
    countdown={countdown} countdownTotal={view?.postPlay.countdownSeconds ?? 10} sceneAfter={sceneAfter} onPlayNow={() => act(playback.next)}
    onWatchCredits={() => {dismissedOffer.current = visibleOffer.id;}} onSkipCredits={() => {if (credits) skipSegment(credits);}}/> : undefined;
  const skipNoticeNode = notice ? <View style={{flexDirection: 'row', alignItems: 'center', gap: phone ? 14 : 28, paddingLeft: phone ? 16 : 30, paddingRight: 6, paddingVertical: phone ? 6 : 16,
    borderRadius: phone ? 12 : 22, overflow: 'hidden', backgroundColor: phone ? 'rgba(7,16,24,.76)' : 'rgba(9,19,27,.8)',
    boxShadow: `inset 0 0 0 1px rgba(237,245,250,.1), 0 14px 30px -12px rgba(0,0,0,.8)`}}>
    <View style={{gap: 8}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: phone ? 8 : 12}}>
        {!phone && <Icon name="i-check" size={26} color={theme.colors.accentStrong}/>}
        <Text style={{fontFamily: 'Manrope-Bold', fontSize: phone ? 14.5 : 24, fontWeight: phone ? '600' : '700', color: phone ? theme.colors.textSecondary : theme.colors.text}}>{t('player.skipped', {kind: notice.kind})}</Text>
      </View>
      {!phone && <View style={{height: 3, width: 240, borderRadius: 2, backgroundColor: 'rgba(237,245,250,.18)'}}>
        <Animated.View style={[{height: 3, borderRadius: 2, backgroundColor: theme.colors.accentStrong}, undoLineStyle]}/>
      </View>}
    </View>
    <Button focusId="watch-skip-undo" testID="watch-skip-undo" variant={phone ? 'glass' : 'glass'} size={phone ? 'compact' : 'hero'} hasTVPreferredFocus={!phone} icon="i-back" iconSize={phone ? 18 : undefined}
      style={phone ? {height: 36, paddingHorizontal: 14, borderRadius: 8} : undefined} textStyle={phone ? {fontSize: 14.5, fontWeight: '700'} : undefined}
      onPress={() => {const from = notice.fromSeconds; setNotice(undefined); if (current()) void playback.seek(fence, from).catch(props.reportError);}}>{t('action.undo')}</Button>
    {phone && <Animated.View style={[{position: 'absolute', left: 0, bottom: 0, height: 2, backgroundColor: 'rgba(237,245,250,.45)'}, undoLineStyle]}/>}
  </View> : undefined;
  const skipPromptNode = prompt ? <>{prompt.kind === 'credits' && sceneAfter && !phone && <View style={{paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(9,19,27,.78)'}}>
      <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 22, fontWeight: '600', color: theme.colors.text}}>{t('player.post.sceneAfter')}</Text>
    </View>}
    <Button focusId="watch-skip-action" testID="watch-skip-action" variant="primary" size={phone ? 'compact' : 'hero'} hasTVPreferredFocus={!phone} icon="i-next" iconSize={phone ? 18 : undefined}
      style={phone ? {height: 44, paddingHorizontal: 16, borderRadius: 10} : undefined} textStyle={phone ? {fontSize: 15, fontWeight: '700'} : undefined}
      onPress={() => skipSegment(prompt)}>{t('player.skip', {kind: prompt.kind})}</Button></> : undefined;
  const skipNodes = skipOfferNode ?? skipNoticeNode ?? skipPromptNode;
  return <GestureDetector gesture={minimizeSwipe}><View testID="watch-chrome" pointerEvents="box-none" style={{width, height}}>
    <Focusable ref={picture} focusId="watch-picture" testID="watch-picture" focusTreatment="none" accessibilityRole="button" accessibilityLabel={identity?.title ?? t('player.opt.menu')}
      hasTVPreferredFocus={theme.isTV && !visible} focusable={theme.isTV && !visible && !state.panel} onPress={() => {if (theme.isTV) controls.key(fence); else controls.toggleVisibility(fence);}} style={{position: 'absolute', inset: 0}}/>
    <Animated.View pointerEvents={visible ? 'box-none' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} style={[{position: 'absolute', inset: 0}, fade]}>
      <Svg pointerEvents="none" width="100%" height="100%" style={{position: 'absolute', inset: 0}}><Defs>
        <LinearGradient id="watch-top" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#03080c" stopOpacity={.82}/><Stop offset=".36" stopColor="#03080c" stopOpacity={0}/></LinearGradient>
        <LinearGradient id="watch-bottom" x1="0" y1="1" x2="0" y2="0"><Stop offset="0" stopColor="#03080c" stopOpacity={.92}/><Stop offset=".5" stopColor="#03080c" stopOpacity={0}/></LinearGradient>
      </Defs><Rect width="100%" height="100%" fill="url(#watch-top)"/><Rect width="100%" height="100%" fill="url(#watch-bottom)"/></Svg>
      <FocusRegion id="watch-controls" orientation="horizontal" entry="watch-toggle" style={{position: 'absolute', inset: 0}}>
        <View style={{position: 'absolute', top: compact ? 4 : theme.isTV ? 80 : 12, left: (compact ? 6 : theme.isTV ? 96 : 54) + (props.edgeInsets?.left ?? 0), right: (compact ? 6 : theme.isTV ? 96 : 54) + (props.edgeInsets?.right ?? 0), flexDirection: 'row', alignItems: theme.isTV ? 'flex-start' : 'center'}}>
          {!theme.isTV && icon('minimize', 'i-down', t('player.minimize'), () => props.onMinimize(fence))}
          {theme.isTV && linear && <>{channelMark}<View style={{flexShrink: 1, minWidth: 0}}>
            <Text numberOfLines={1} style={[nativeType({size: 44, weight: 800, tracking: -.03, lineHeight: 52}, theme.textScale), {color: theme.colors.text}]}>{linear.programme?.title ?? linear.name}</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', minWidth: 0}}>
              <Text numberOfLines={1} style={[theme.type.bodyStrong, {fontSize: 24, lineHeight: 32, color: theme.colors.text, flexShrink: 0}]}>{linear.name}</Text>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 18}}>
                <View style={{width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.record}}/>
                <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 22, fontWeight: '600', color: theme.colors.text}}>{t('next.kit.live')}</Text>
              </View>
            </View>
            <View style={{flexDirection: 'row', alignItems: 'baseline', minWidth: 0}}>
              {linear.programme && <Text numberOfLines={1} style={[theme.type.bodyStrong, {fontSize: 24, lineHeight: 32, marginRight: 12, color: theme.colors.textSecondary}]}>{t('next.kit.range', {start: wallClock(linear.programme.startMs), end: wallClock(linear.programme.endMs)})}</Text>}
              {linear.next && <Text numberOfLines={1} ellipsizeMode="tail" style={[theme.type.bodyStrong, {fontSize: 24, lineHeight: 32, color: theme.colors.textTertiary, flexShrink: 1}]}>{t('player.live.next', {title: linear.next.title})}</Text>}
            </View>
          </View></>}
          {theme.isTV && !compact && <FocusRegion id="watch-group" entry="player-group-pill" orientation="horizontal" edges={{down: 'watch-controls'}}>
            <NativeTVGroupPill/>
          </FocusRegion>}
          {!linear && !compact && theme.isTV && identity && <View style={{flexShrink: 1, minWidth: 0, marginLeft: 8}}><Text numberOfLines={1} style={[nativeType({size: 16.5, weight: 800, tracking: -.015, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{identity.title}</Text>
            {theme.isTV ? <View style={{flexDirection: 'row', alignItems: 'baseline', minWidth: 0}}>{identity!.subtitle.map((part, index) =>
              <Text key={`${part.role}:${index}`} numberOfLines={1} ellipsizeMode="tail" style={[theme.type.bodyStrong, {fontSize: 24, lineHeight: 32, color: theme.colors.textSecondary},
                {flexShrink: index === 0 ? 0 : 1, marginRight: 10}]}>{part.text}</Text>)}</View>
              : <Text numberOfLines={1} style={[theme.type.bodyStrong, {fontSize: 13, color: theme.colors.textSecondary}]}>{identity!.subtitle.map(part => part.text).join(' ')}</Text>}</View>}
          {!theme.isTV && linear && <View style={{flexShrink: 1, minWidth: 0}}>
            <Text numberOfLines={1} style={[nativeType({size: 16.5, weight: 800, tracking: -.015, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{linear.programme?.title ?? linear.name}</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', minWidth: 0, marginTop: 1}}>
              <Text numberOfLines={1} style={[theme.type.bodyStrong, {fontSize: 13, color: theme.colors.textSecondary, flexShrink: 0}]}>{linear.name}</Text>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 10}}>
                <View style={{width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.colors.record}}/>
                <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 12, fontWeight: '600', color: theme.colors.text}}>{t('next.kit.live')}</Text>
              </View>
            </View>
          </View>}
          {!theme.isTV && !linear && !compact && identity && <View style={{flexShrink: 1, minWidth: 0, marginLeft: 8}}>
            <Text numberOfLines={1} style={[nativeType({size: 16.5, weight: 800, tracking: -.015, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{identity.title}</Text>
            <Text numberOfLines={1} style={[theme.type.bodyStrong, {fontSize: 13, marginTop: 1, color: theme.colors.textSecondary}]}>{identity.subtitle.map(part => part.text).join('  ')}</Text>
          </View>}
          <View style={{flex: 1}}/>
          {theme.isTV && !linear && <View style={{marginLeft: 14, alignItems: 'flex-end'}}>
            <Text style={{fontFamily: 'Manrope-Bold', fontSize: 32, lineHeight: 40, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums']}}>{wallClock(now)}</Text>
            <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 22, lineHeight: 26, fontWeight: '600', marginTop: 2, color: theme.colors.textSecondary}}>{t('next.watch.ends', {time: wallClock(now + Math.max(0, source.playback.duration - source.playback.positionSeconds) * 1000)})}</Text>
          </View>}
          {props.onCast && !theme.isTV && !linear && icon('cast', 'i-cast', t('player.playOn'), () => props.onCast!(fence))}
          {props.onPictureInPicture && !theme.isTV && icon('pip', 'i-pip', t('player.pictureInPicture'), () => props.onPictureInPicture!(fence))}
          {!theme.isTV && icon('options', 'i-sliders', t('player.opt.menu'), () => panel('options'))}
        </View>
        {!theme.isTV && <View style={{position: 'absolute', left: 0, right: 0, top: height / 2 - big / 2, alignItems: 'center'}}>{transport}</View>}
        {theme.isTV && <View style={{position: 'absolute', left: 96 + (props.edgeInsets?.left ?? 0), right: 96 + (props.edgeInsets?.right ?? 0), bottom: 80}}>
          <NativeWatchTimeline source={source} controls={controls} playback={playback} compact={compact} enabled={visible} tv focused={seekFocused} onPreview={setLanding} liveEdge={liveEdge} reportError={props.reportError} skipBackSeconds={props.skipBackSeconds} skipForwardSeconds={props.skipForwardSeconds}/>
          {landing === undefined && <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, height: 30, marginTop: 10}}>
            <Text style={[theme.type.bodyStrong, {fontSize: 24, color: theme.colors.text, fontVariant: ['tabular-nums']}]}>{clockText(source.playback.positionSeconds)}</Text>
            {linear && behindLive > 30 && <Text style={[theme.type.bodyStrong, {fontSize: 22, marginLeft: 12, color: theme.colors.textSecondary}]}>{t('player.live.behindLive', {duration: clockText(Math.round(behindLive / 60) * 60)})}</Text>}
            <View style={{flex: 1}}/>
            {linear && behindLive > 5 && props.goLive
              ? <Focusable focusId="watch-go-live" testID="watch-go-live" accessibilityRole="button" focusable={visible} disabled={!visible}
                  onPress={() => {if (current() && props.goLive) {controls.reveal(fence); props.goLive(fence);}}}
                  style={{height: 48, paddingHorizontal: 20, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(237,245,250,.14)'}}>
                  <View style={{width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.record}}/>
                  <Text style={{fontFamily: 'Manrope-Bold', fontSize: 21, fontWeight: '700', color: theme.colors.text}}>{t('player.live.goLive')}</Text>
                </Focusable>
              : <Text style={[theme.type.bodyStrong, {fontSize: 24, color: theme.colors.textSecondary, fontVariant: ['tabular-nums']}]}>{clockText(Math.max(0, source.playback.duration - source.playback.positionSeconds))}</Text>}
          </View>}
          {seekFocused
            ? <View style={{height: 88, marginTop: 20, flexDirection: 'row', alignItems: 'center'}}>
              {hint(0, keycap('', ['i-left', 'i-right']), t('player.hint.move'))}
              {hint(1, keycap('Hold'), t('player.hint.faster'))}
              {hint(2, keycap('OK'), t('player.hint.playFrom', {time: clockText(landing ?? returnAt)}))}
              {hint(3, keycap('Back'), t('player.hint.returnTo', {time: clockText(returnAt)}))}
            </View>
            : <View style={{height: 88, marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
              <View style={{flex: 1}}>{linear
                ? (props.onGuide ? <Focusable focusId="watch-guide" testID="watch-guide" accessibilityRole="button" focusable={visible} disabled={!visible} onPress={() => {if (current() && props.onGuide) props.onGuide();}}
                    style={{height: 64, paddingHorizontal: 26, borderRadius: 32, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(237,245,250,.14)'}}>
                    <Icon name="i-list" size={28} color={theme.colors.text}/><Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 22, fontWeight: '600', color: theme.colors.text}}>{t('player.live.guide')}</Text>
                  </Focusable> : null)
                : fence.kind === 'queue' && fence.showId && option('episodes', t('title.episodes'))}</View>
              {transport}
              <View style={{flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 14}}>
                {source.capabilities.subtitleTrack && option('subtitles', linear ? t('player.live.captions') : t('player.opt.subtitles'), props.subtitle ?? (linear ? t('player.opt.off') : undefined))}
                {source.capabilities.audioTrack && audioTracks > 1 && option('audio', t('title.audio'), props.audio)}
                {option('quality', t('player.opt.quality'), props.quality)}
                {icon('options', 'i-sliders', t('player.opt.menu'), () => panel('options'))}
                {props.onPictureInPicture && icon('pip', 'i-pip', t('player.pictureInPicture'), () => props.onPictureInPicture!(fence))}
              </View>
            </View>}
        </View>}
        {!theme.isTV && <View style={{position: 'absolute', left: (compact ? 14 : 60) + (props.edgeInsets?.left ?? 0), right: (compact ? 6 : 60) + (props.edgeInsets?.right ?? 0), bottom: compact ? 8 : 15}}>
          {!compact && <View style={{marginBottom: 8}}>
            <NativeWatchTimeline source={source} controls={controls} playback={playback} compact={compact} enabled={visible} liveEdge={liveEdge} onPreview={setLanding} reportError={props.reportError} skipBackSeconds={props.skipBackSeconds} skipForwardSeconds={props.skipForwardSeconds}/>
          </View>}
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
            <Text style={[theme.type.bodyStrong, {fontSize: 12.5, color: theme.colors.text, fontVariant: ['tabular-nums']}]}>{clockText(source.playback.positionSeconds)}</Text>
            {linear && behindLive > 30 && <Text style={[theme.type.bodyStrong, {fontSize: 12, marginLeft: 8, color: theme.colors.textSecondary}]}>{t('player.live.behindLive', {duration: clockText(Math.round(behindLive / 60) * 60)})}</Text>}
            {compact && <Text style={[theme.type.bodyStrong, {fontSize: 12, color: theme.colors.textSecondary}]}>{`/ ${clockText(source.playback.duration)}`}</Text>}
            <View style={{flex: 1}}/>
            {!compact && (linear && behindLive > 5 && props.goLive
              ? <Focusable focusId="watch-go-live" testID="watch-go-live" accessibilityRole="button" focusable={visible} disabled={!visible}
                  onPress={() => {if (current() && props.goLive) {controls.reveal(fence); props.goLive(fence);}}}
                  style={{height: 28, paddingHorizontal: 12, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(237,245,250,.14)'}}>
                  <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.record}}/>
                  <Text style={{fontFamily: 'Manrope-Bold', fontSize: 12.5, fontWeight: '700', color: theme.colors.text}}>{t('player.live.goLive')}</Text>
                </Focusable>
              : <Text style={[theme.type.bodyStrong, {fontSize: 12.5, color: theme.colors.textSecondary, fontVariant: ['tabular-nums']}]}>{clockText(Math.max(0, source.playback.duration - source.playback.positionSeconds))}</Text>)}
            {compact && <>{qualityChip(true)}{props.onFullWindow && icon('fullscreen', 'i-fs', t('next.states.shortcut.fullscreen'), () => props.onFullWindow!(fence))}</>}
          </View>
          {!compact && <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8}}>
            {linear
              ? (props.onGuide ? chip('episodes', 'i-list', t('player.live.guide'), undefined, () => {if (current() && props.onGuide) props.onGuide();}) : null)
              : fence.kind === 'queue' && fence.showId ? chip('episodes', 'i-stack', t('title.episodes'), undefined) : null}
            <View style={{flex: 1}}/>
            {source.capabilities.subtitleTrack && chip('subtitles', 'i-cc', linear ? t('player.live.captions') : t('player.opt.subtitles'), props.subtitle ?? (linear ? t('player.opt.off') : undefined))}
            {source.capabilities.audioTrack && audioTracks > 1 && chip('audio', 'i-audio', t('title.audio'), props.audio)}
            {qualityChip()}
          </View>}
        </View>}
        {!theme.isTV && compact && <View style={{position: 'absolute', left: (props.edgeInsets?.left ?? 0), right: (props.edgeInsets?.right ?? 0), bottom: -21}}>
          <NativeWatchTimeline source={source} controls={controls} playback={playback} compact enabled={visible} onPreview={setLanding} reportError={props.reportError} skipBackSeconds={props.skipBackSeconds} skipForwardSeconds={props.skipForwardSeconds}/>
        </View>}
      </FocusRegion>
    </Animated.View>
    {props.notice && state.panel === undefined && <LossNotice notice={props.notice} top={theme.isTV ? 168 : 68} gutter={theme.isTV ? 96 : 16}/>}
    {skipNodes && <View pointerEvents="box-none" style={{position: 'absolute', right: theme.isTV ? 96 : 60,
      bottom: theme.isTV ? 284 : visible ? 110 : 20}}>
      {theme.isTV
        ? <FocusRegion id="watch-skip" orientation="horizontal" entry={visibleOffer ? 'watch-up-next-play' : notice ? 'watch-skip-undo' : 'watch-skip-action'}>
            <View testID="watch-skip-prompt" style={{flexDirection: 'row', alignItems: 'center', gap: 22}}>{skipNodes}</View>
          </FocusRegion>
        : <View testID="watch-skip-prompt" style={{flexDirection: 'row', alignItems: 'center', gap: 22}}>{skipNodes}</View>}
    </View>}
  </View></GestureDetector>;
}
