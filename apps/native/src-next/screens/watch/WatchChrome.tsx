import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Text, View, useTVEventHandler} from 'react-native';
import Animated, {cancelAnimation, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import Svg, {Defs, LinearGradient, Path, Rect, Stop, Text as SvgText} from 'react-native-svg';
import {sameFence, type PlaybackFence} from '../../../../../packages/player-core/src';
import {playbackIdentity, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativePlaybackRuntimeSnapshot} from '../../platform/playback/types';
import type {NativeShellPlaybackAdapter} from '../../shell/playback';
import {Button, Focusable} from '../../kit/controls';
import {FocusRegion, useFocusRegistry} from '../../kit/focus';
import {Icon, type IconName} from '../../kit/Icon';
import {nativeType, useTheme} from '../../kit/theme';
import {useMotion} from '../../kit/useMotion';
import {NativeWatchControls, type NativeWatchPanel} from './controls';
import {NativeWatchTimeline} from './WatchTimeline';

export type NativeWatchChromeProps = Readonly<{
  source: NativePlaybackRuntimeSnapshot;
  controls: NativeWatchControls;
  playback: Pick<NativeShellPlaybackAdapter, 'getSnapshot' | 'toggle' | 'skip' | 'seek' | 'previous' | 'next'>;
  text: TextEnvironment;
  /** Delivered by the current-fence producers, never the first/default offer or a policy ceiling. */
  quality: string;
  audio?: string;
  subtitle?: string;
  /** Actual physical picture pane; centre transport is centred inside it, including book mode. */
  width: number;
  height: number;
  compact: boolean;
  /** Book-mode edge chrome avoids the padded crease; centre transport does not move. */
  edgeInsets?: Readonly<{left?: number; right?: number}>;
  skipBackSeconds: number;
  skipForwardSeconds: number;
  onMinimize: (fence: PlaybackFence) => void;
  onPanel?: (panel: NativeWatchPanel, fence: PlaybackFence) => void;
  /** TV4 keeps only identity/seek dimmed behind the authored overlay. */
  tvPanelRight?: number;
  reportError: (error: unknown) => void;
  onPictureInPicture?: (fence: PlaybackFence) => void;
  onCast?: (fence: PlaybackFence) => void;
  onFullWindow?: (fence: PlaybackFence) => void;
}>;

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
  const seekFocused = theme.isTV && visible && !state.panel && focus?.regionId === 'watch-controls' && focus.childId === 'watch-seek';
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
  const panel = (value: NativeWatchPanel) => {if (current() && controls.open(value, fence)) props.onPanel?.(value, fence);};
  const identity = source.subject ? playbackIdentity(source.subject, 'full', props.text) : undefined;
  const queue = fence.kind === 'queue' && (source.queue.view?.items.length ?? 0) > 1;
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
  const big = theme.isTV ? 88 : compact ? 58 : 74, small = theme.isTV ? 64 : compact ? 46 : 58;
  const icon = (id: string, name: IconName, label: string, onPress: () => void, primary = false, disabled = false) => <Button focusId={`watch-${id}`} testID={`watch-${id}`} variant={primary ? 'primary' : theme.isTV ? 'icon' : 'text'} iconOnly icon={name} accessibilityLabel={label}
    focusable={visible} disabled={disabled || !visible} onPress={onPress} style={{width: primary ? big : small, height: primary ? big : small, borderRadius: (primary ? big : small) / 2}} iconSize={primary ? theme.isTV ? 40 : 28 : theme.isTV ? 26 : 22}/>;
  const skip = (forward: boolean) => <Focusable focusId={forward ? 'watch-skip-forward' : 'watch-skip-back'} testID={forward ? 'watch-skip-forward' : 'watch-skip-back'} focusable={visible} disabled={!visible || !source.capabilities.seek} accessibilityRole="button"
    accessibilityLabel={t(forward ? 'player.skipForwardSeconds' : 'player.skipBackSeconds', {seconds: forward ? props.skipForwardSeconds : props.skipBackSeconds})}
    onPress={() => act(expected => playback.skip(expected, forward ? props.skipForwardSeconds : -props.skipBackSeconds))}
    style={{width: small, height: small, alignItems: 'center', justifyContent: 'center', opacity: source.capabilities.seek ? 1 : .4}}>
    <SkipIcon color={theme.colors.text} forward={forward} seconds={forward ? props.skipForwardSeconds : props.skipBackSeconds} size={theme.isTV ? 36 : compact ? 30 : 38}/>
  </Focusable>;
  const option = (name: NativeWatchPanel, label: string, value?: string) => <Focusable focusId={`watch-option-${name}`} testID={`watch-option-${name}`} accessibilityRole="button" focusable={visible} disabled={!visible} onPress={() => panel(name)} style={{minHeight: theme.isTV ? 64 : 36, paddingHorizontal: theme.isTV ? 16 : 12, paddingVertical: theme.isTV ? 10 : 6, justifyContent: 'center', borderRadius: theme.isTV ? 12 : 8, backgroundColor: theme.colors.raisedHigh}}>
    {theme.isTV ? <><Text style={{fontFamily: theme.type.bodyStrong.fontFamily, fontSize: 20, color: theme.colors.text}}>{label}</Text>{value && <Text style={{fontFamily: theme.type.body.fontFamily, fontSize: 17, color: theme.colors.textSecondary}}>{value}</Text>}</> : <Text style={[theme.type.caption, {color: theme.colors.text}]}>{value ? label ? `${label} ${value}` : value : label}</Text>}
  </Focusable>;
  const keycap = (label: string, icons?: IconName[]) => <View style={{minWidth: 44, height: 36, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, borderColor: 'rgba(237,245,250,.3)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2}}>
    {icons ? icons.map(name => <Icon key={name} name={name} size={20} color={theme.colors.textSecondary}/>) : <Text style={{fontFamily: 'Manrope-ExtraBold', fontSize: 17, fontWeight: '800', color: theme.colors.textSecondary}}>{label}</Text>}
  </View>;
  const hint = (index: number, cap: React.ReactNode, text: string) => <View key={text} style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: index ? 26 : 0}}>{cap}
    <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 20, fontWeight: '600', color: theme.colors.textTertiary}}>{text}</Text></View>;
  const transport = <View style={{flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 20 : compact ? 12 : 38}}>
    {queue && icon('previous', 'i-prev', t('player.previous'), () => act(playback.previous), false, !source.capabilities.previous)}
    {skip(false)}
    <Button ref={toggle} testID="watch-toggle" focusId="watch-toggle" variant="primary" iconOnly icon={source.playback.intent === 'playing' ? 'i-pause' : 'i-play'}
      accessibilityLabel={t(source.playback.intent === 'playing' ? 'action.pause' : 'action.play')} hasTVPreferredFocus={theme.isTV && visible}
      focusable={visible} disabled={!visible || !source.capabilities.play && !source.capabilities.pause} onPress={() => act(playback.toggle)}
      style={{width: big, height: big, borderRadius: big / 2}} iconSize={theme.isTV ? 40 : 28}/>
    {skip(true)}
    {queue && icon('next', 'i-next', t('player.next'), () => act(playback.next), false, !source.capabilities.next)}
  </View>;
  return <View testID="watch-chrome" pointerEvents="box-none" style={{width, height}}>
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
          {!compact && identity && <View style={{flexShrink: 1, minWidth: 0, marginLeft: theme.isTV ? 0 : 8}}><Text numberOfLines={1} style={[nativeType({size: theme.isTV ? 44 : 16.5, weight: 800, tracking: theme.isTV ? -.03 : -.015, lineHeight: theme.isTV ? 52 : 'normal'}, theme.textScale), {color: theme.colors.text}]}>{identity.title}</Text>
            <Text numberOfLines={1} style={[theme.type.bodyStrong, {fontSize: theme.isTV ? 24 : 13, lineHeight: theme.isTV ? 32 : undefined, color: theme.colors.textSecondary}]}>{identity.subtitle.map(part => part.text).join(' ')}</Text></View>}
          <View style={{flex: 1}}/>
          {theme.isTV && <View style={{marginLeft: 14, alignItems: 'flex-end'}}>
            <Text style={{fontFamily: 'Manrope-Bold', fontSize: 32, lineHeight: 40, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums']}}>{wallClock(now)}</Text>
            <Text style={{fontFamily: 'Manrope-SemiBold', fontSize: 22, lineHeight: 26, fontWeight: '600', marginTop: 2, color: theme.colors.textSecondary}}>{t('next.watch.ends', {time: wallClock(now + Math.max(0, source.playback.duration - source.playback.positionSeconds) * 1000)})}</Text>
          </View>}
          {props.onCast && !theme.isTV && icon('cast', 'i-cast', t('player.playOn'), () => props.onCast!(fence))}
          {props.onPictureInPicture && !theme.isTV && icon('pip', 'i-pip', t('player.pictureInPicture'), () => props.onPictureInPicture!(fence))}
          {!theme.isTV && icon('options', 'i-sliders', t('player.opt.menu'), () => panel('options'))}
        </View>
        {!theme.isTV && <View style={{position: 'absolute', left: 0, right: 0, top: height / 2 - big / 2, alignItems: 'center'}}>{transport}</View>}
        {theme.isTV && <View style={{position: 'absolute', left: 96 + (props.edgeInsets?.left ?? 0), right: 96 + (props.edgeInsets?.right ?? 0), bottom: 80}}>
          <NativeWatchTimeline source={source} controls={controls} playback={playback} compact={compact} enabled={visible} tv focused={seekFocused} onPreview={setLanding} reportError={props.reportError} skipBackSeconds={props.skipBackSeconds} skipForwardSeconds={props.skipForwardSeconds}/>
          {landing === undefined && <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, height: 30, marginTop: 10}}>
            <Text style={[theme.type.bodyStrong, {fontSize: 24, color: theme.colors.text, fontVariant: ['tabular-nums']}]}>{clockText(source.playback.positionSeconds)}</Text>
            <View style={{flex: 1}}/>
            <Text style={[theme.type.bodyStrong, {fontSize: 24, color: theme.colors.textSecondary, fontVariant: ['tabular-nums']}]}>{clockText(Math.max(0, source.playback.duration - source.playback.positionSeconds))}</Text>
          </View>}
          {seekFocused
            ? <View style={{height: 88, marginTop: 20, flexDirection: 'row', alignItems: 'center'}}>
              {hint(0, keycap('', ['i-left', 'i-right']), t('player.hint.move'))}
              {hint(1, keycap('Hold'), t('player.hint.faster'))}
              {hint(2, keycap('OK'), t('player.hint.playFrom', {time: clockText(landing ?? returnAt)}))}
              {hint(3, keycap('Back'), t('player.hint.returnTo', {time: clockText(returnAt)}))}
            </View>
            : <View style={{height: 88, marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
              <View style={{flex: 1}}>{fence.kind === 'queue' && fence.showId && option('episodes', t('title.episodes'))}</View>
              {transport}
              <View style={{flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 14}}>
                {source.capabilities.subtitleTrack && option('subtitles', t('player.opt.subtitles'), props.subtitle)}
                {source.capabilities.audioTrack && option('audio', t('title.audio'), props.audio)}
                {option('quality', t('player.opt.quality'), props.quality)}
                {icon('options', 'i-sliders', t('player.opt.menu'), () => panel('options'))}
                {props.onPictureInPicture && icon('pip', 'i-pip', t('player.pictureInPicture'), () => props.onPictureInPicture!(fence))}
              </View>
            </View>}
        </View>}
        {!theme.isTV && <View style={{position: 'absolute', left: (compact ? 14 : 60) + (props.edgeInsets?.left ?? 0), right: (compact ? 6 : 60) + (props.edgeInsets?.right ?? 0), bottom: compact ? 8 : 15}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
            <Text style={[theme.type.bodyStrong, {fontSize: 12.5, color: theme.colors.text}]}>{clockText(source.playback.positionSeconds)}</Text>
            {compact && <Text style={[theme.type.bodyStrong, {fontSize: 12, color: theme.colors.textSecondary}]}>{`/ ${clockText(source.playback.duration)}`}</Text>}
            <View style={{flex: 1}}/>
            {!compact && <Text style={[theme.type.bodyStrong, {fontSize: 12.5, color: theme.colors.textSecondary}]}>{clockText(Math.max(0, source.playback.duration - source.playback.positionSeconds))}</Text>}
            {compact && <>{option('quality', '', props.quality)}{props.onFullWindow && icon('fullscreen', 'i-fs', t('next.states.shortcut.fullscreen'), () => props.onFullWindow!(fence))}</>}
          </View>
          {!compact && <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10}}>
            <View style={{flex: 1}}>{fence.kind === 'queue' && fence.showId && option('episodes', t('title.episodes'))}</View>
            <View style={{flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 8}}>
              {source.capabilities.subtitleTrack && option('subtitles', t('player.opt.subtitles'), props.subtitle)}
              {source.capabilities.audioTrack && option('audio', t('title.audio'), props.audio)}
              {option('quality', '', props.quality)}
            </View>
          </View>}
        </View>}
        <View style={{position: 'absolute', left: (compact ? 0 : 120) + (props.edgeInsets?.left ?? 0), right: (compact ? 0 : 112) + (props.edgeInsets?.right ?? 0), bottom: compact ? -21 : 58}}>
          {!theme.isTV && <NativeWatchTimeline source={source} controls={controls} playback={playback} compact={compact} enabled={visible} onPreview={setLanding} reportError={props.reportError} skipBackSeconds={props.skipBackSeconds} skipForwardSeconds={props.skipForwardSeconds}/>}
        </View>
      </FocusRegion>
    </Animated.View>
  </View>;
}
