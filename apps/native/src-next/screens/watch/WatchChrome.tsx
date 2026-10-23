import React, {useEffect, useRef, useSyncExternalStore} from 'react';
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
import {FocusRegion} from '../../kit/focus';
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
  skipBackSeconds: number;
  skipForwardSeconds: number;
  onMinimize: (fence: PlaybackFence) => void;
  onPanel: (panel: NativeWatchPanel, fence: PlaybackFence) => void;
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
  const theme = useTheme(), motion = useMotion(), state = useSyncExternalStore(controls.subscribe, controls.getSnapshot);
  const opacity = useSharedValue(0), toggle = useRef<View>(null), picture = useRef<View>(null);
  const fence = source.fence;
  const current = () => !!fence && !source.retired && sameFence(playback.getSnapshot().fence, fence) && sameFence(state.fence, fence);
  const visible = current() && state.visible;
  useEffect(() => {
    // motion.html 2.6/4.5: controls enter standard, timer exit slow; no geometry animation here.
    opacity.value = withTiming(visible ? 1 : 0, motion.timing(visible || state.hideReason !== 'timer' ? 'standard' : 'slow'));
    return () => cancelAnimation(opacity);
  }, [visible, motion, opacity, state.hideReason]);
  const fade = useAnimatedStyle(() => ({opacity: opacity.value}));
  useEffect(() => {
    if (!theme.isTV || !fence || !current()) return;
    const node = visible ? toggle.current : picture.current;
    node?.requestTVFocus?.();
  }, [visible, fence, theme.isTV]); // The native focus engine owns movement inside the region.
  useTVEventHandler(event => {
    if (!theme.isTV || !fence || !current() || source.dock.local?.expanded !== true || state.panel || event.eventKeyAction === 1) return;
    if (['up', 'down', 'left', 'right', 'select', 'longLeft', 'longRight'].includes(event.eventType)) {
      if (!controls.key(fence)) controls.reveal(fence);
    }
  });
  if (!fence || !current() || source.dock.local?.expanded !== true) return null;
  const act = (command: (expected: PlaybackFence) => Promise<void>) => {if (current()) {controls.reveal(fence); void command(fence).catch(props.reportError);}};
  const panel = (value: NativeWatchPanel) => {if (current()) props.onPanel(value, fence);};
  const identity = source.subject ? playbackIdentity(source.subject, 'full', props.text) : undefined;
  const queue = fence.kind === 'queue' && (source.queue.view?.items.length ?? 0) > 1;
  const big = theme.isTV ? 88 : compact ? 58 : 74, small = theme.isTV ? 64 : compact ? 46 : 58;
  const icon = (name: IconName, label: string, onPress: () => void, primary = false, disabled = false) => <Button variant={primary ? 'primary' : theme.isTV ? 'icon' : 'text'} iconOnly icon={name} accessibilityLabel={label}
    focusable={visible} disabled={disabled || !visible} onPress={onPress} style={{width: primary ? big : small, height: primary ? big : small, borderRadius: (primary ? big : small) / 2}} iconSize={primary ? theme.isTV ? 40 : 28 : theme.isTV ? 26 : 22}/>;
  const skip = (forward: boolean) => <Focusable focusable={visible} disabled={!visible || !source.capabilities.seek} accessibilityRole="button"
    accessibilityLabel={t(forward ? 'player.skipForwardSeconds' : 'player.skipBackSeconds', {seconds: forward ? props.skipForwardSeconds : props.skipBackSeconds})}
    onPress={() => act(expected => playback.skip(expected, forward ? props.skipForwardSeconds : -props.skipBackSeconds))}
    style={{width: small, height: small, alignItems: 'center', justifyContent: 'center', opacity: source.capabilities.seek ? 1 : .4}}>
    <SkipIcon color={theme.colors.text} forward={forward} seconds={forward ? props.skipForwardSeconds : props.skipBackSeconds} size={theme.isTV ? 36 : compact ? 30 : 38}/>
  </Focusable>;
  const option = (name: NativeWatchPanel, label: string, value?: string) => <Button variant="glass" size="small" focusable={visible} disabled={!visible} onPress={() => panel(name)} style={{height: theme.isTV ? 64 : 36, paddingHorizontal: theme.isTV ? 16 : 12}}>
    {theme.isTV ? <Text style={{fontFamily: theme.type.bodyStrong.fontFamily, fontSize: 20, color: theme.colors.text}}>{label}{value ? `\n${value}` : ''}</Text> : value ? `${label} ${value}` : label}
  </Button>;
  const transport = <View style={{flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 20 : compact ? 12 : 38}}>
    {queue && icon('i-prev', t('player.previous'), () => act(playback.previous), false, !source.capabilities.previous)}
    {skip(false)}
    <Button ref={toggle} testID="watch-toggle" focusId="watch-toggle" variant="primary" iconOnly icon={source.playback.intent === 'playing' ? 'i-pause' : 'i-play'}
      accessibilityLabel={t(source.playback.intent === 'playing' ? 'action.pause' : 'action.play')} hasTVPreferredFocus={theme.isTV && visible}
      focusable={visible} disabled={!visible || !source.capabilities.play && !source.capabilities.pause} onPress={() => act(playback.toggle)}
      style={{width: big, height: big, borderRadius: big / 2}} iconSize={theme.isTV ? 40 : 28}/>
    {skip(true)}
    {queue && icon('i-next', t('player.next'), () => act(playback.next), false, !source.capabilities.next)}
  </View>;
  return <View testID="watch-chrome" pointerEvents="box-none" style={{width, height}}>
    <Focusable ref={picture} focusId="watch-picture" testID="watch-picture" focusTreatment="none" accessibilityRole="button" accessibilityLabel={identity?.title ?? t('player.opt.menu')}
      hasTVPreferredFocus={theme.isTV && !visible} focusable={theme.isTV && !visible && !state.panel} onPress={() => controls.toggleVisibility(fence)} style={{position: 'absolute', inset: 0}}/>
    <Animated.View pointerEvents={visible ? 'box-none' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} style={[{position: 'absolute', inset: 0}, fade]}>
      <Svg pointerEvents="none" width="100%" height="100%" style={{position: 'absolute', inset: 0}}><Defs>
        <LinearGradient id="watch-top" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#03080c" stopOpacity={.82}/><Stop offset=".36" stopColor="#03080c" stopOpacity={0}/></LinearGradient>
        <LinearGradient id="watch-bottom" x1="0" y1="1" x2="0" y2="0"><Stop offset="0" stopColor="#03080c" stopOpacity={.92}/><Stop offset=".5" stopColor="#03080c" stopOpacity={0}/></LinearGradient>
      </Defs><Rect width="100%" height="100%" fill="url(#watch-top)"/><Rect width="100%" height="100%" fill="url(#watch-bottom)"/></Svg>
      <FocusRegion id="watch-controls" orientation="horizontal" entry="watch-toggle" style={{position: 'absolute', inset: 0}}>
        <View style={{position: 'absolute', top: compact ? 4 : theme.isTV ? 80 : 12, left: compact ? 6 : theme.isTV ? 96 : 54, right: compact ? 6 : theme.isTV ? 96 : 54, flexDirection: 'row', alignItems: 'center'}}>
          {!theme.isTV && icon('i-down', t('player.minimize'), () => props.onMinimize(fence))}
          {!compact && identity && <View style={{flexShrink: 1, minWidth: 0, marginLeft: theme.isTV ? 0 : 8}}><Text numberOfLines={1} style={[nativeType({size: theme.isTV ? 44 : 16.5, weight: 800, tracking: -.015, lineHeight: 'normal'}), {color: theme.colors.text}]}>{identity.title}</Text>
            <Text numberOfLines={1} style={[theme.type.bodyStrong, {fontSize: theme.isTV ? 24 : 13, color: theme.colors.textSecondary}]}>{identity.subtitle.map(part => part.text).join(' ')}</Text></View>}
          <View style={{flex: 1}}/>
          {props.onCast && !theme.isTV && icon('i-cast', t('player.playOn'), () => props.onCast!(fence))}
          {props.onPictureInPicture && !theme.isTV && icon('i-pip', t('player.pictureInPicture'), () => props.onPictureInPicture!(fence))}
          {!theme.isTV && icon('i-sliders', t('player.opt.menu'), () => panel('options'))}
        </View>
        {!theme.isTV && <View style={{position: 'absolute', left: 0, right: 0, top: height / 2 - big / 2, alignItems: 'center'}}>{transport}</View>}
        <View style={{position: 'absolute', left: theme.isTV ? 96 : compact ? 14 : 60, right: theme.isTV ? 96 : compact ? 6 : 60, bottom: theme.isTV ? 80 : compact ? 8 : 15}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
            <Text style={[theme.type.bodyStrong, {fontSize: theme.isTV ? 24 : 12.5, color: theme.colors.text}]}>{clockText(source.playback.positionSeconds)}</Text>
            {compact && <Text style={[theme.type.bodyStrong, {fontSize: 12, color: theme.colors.textSecondary}]}>{`/ ${clockText(source.playback.duration)}`}</Text>}
            <View style={{flex: 1}}/>
            {!compact && <Text style={[theme.type.bodyStrong, {fontSize: theme.isTV ? 24 : 12.5, color: theme.colors.textSecondary}]}>{clockText(Math.max(0, source.playback.duration - source.playback.positionSeconds))}</Text>}
            {compact && <>{option('quality', '', props.quality)}{props.onFullWindow && icon('i-fs', t('next.states.shortcut.fullscreen'), () => props.onFullWindow!(fence))}</>}
          </View>
          {!compact && <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: theme.isTV ? 24 : 10}}>
            <View style={{flex: 1}}>{fence.kind === 'queue' && fence.showId && option('episodes', t('title.episodes'))}</View>
            {theme.isTV && transport}
            <View style={{flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: theme.isTV ? 14 : 8}}>
              {source.capabilities.subtitleTrack && option('subtitles', t('player.opt.subtitles'), props.subtitle)}
              {source.capabilities.audioTrack && option('audio', t('title.audio'), props.audio)}
              {option('quality', theme.isTV ? t('player.opt.quality') : '', props.quality)}
              {theme.isTV && icon('i-sliders', t('player.opt.menu'), () => panel('options'))}
              {props.onPictureInPicture && theme.isTV && icon('i-pip', t('player.pictureInPicture'), () => props.onPictureInPicture!(fence))}
            </View>
          </View>}
        </View>
        <View style={{position: 'absolute', left: theme.isTV ? 96 : compact ? 0 : 120, right: theme.isTV ? 96 : compact ? 0 : 112, bottom: theme.isTV ? 208 : compact ? -21 : 58}}>
          <NativeWatchTimeline source={source} controls={controls} playback={playback} compact={compact} enabled={visible} reportError={props.reportError} skipBackSeconds={props.skipBackSeconds} skipForwardSeconds={props.skipForwardSeconds}/>
        </View>
      </FocusRegion>
    </Animated.View>
  </View>;
}
