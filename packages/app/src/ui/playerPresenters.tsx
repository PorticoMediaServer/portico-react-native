import React, {useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {PorticoIcon, type PorticoIconId} from '@portico-react-native/icons';
import type {PersistentPlaybackSnapshot} from './playbackSession';
import {TV_PLAYER_FOCUS, TV_PLAYER_FOCUS_ENTRY} from './playerFocusTopology';
import {color, font} from './tokens';
import {Focusable, TVLogicalFocusContainerBoundary} from './primitives';
import type {TVLogicalFocusContainer} from '@portico-react-native/tv-focus';

type TransportProps = {
  canNext?: boolean;
  canPlayPause?: boolean;
  canPrevious?: boolean;
  canSeek?: boolean;
  isPlaying: boolean;
  onNext(): void;
  onPlayPause(): void;
  onPrevious(): void;
  onSeekBack(): void;
  onSeekForward(): void;
  platform: 'mobile' | 'tv';
  focusContainer?: TVLogicalFocusContainer;
};

export function FiveControlTransport(props: TransportProps) {
  const transport = <View nativeID={props.platform === 'tv' ? TV_PLAYER_FOCUS.transport : undefined} style={[styles.transport, props.platform === 'tv' && styles.transportTV]} testID={`portico-${props.platform}-five-control-transport`}>
    <TransportButton disabled={!props.canPrevious} focusId="player:transport:previous" id="playback.previous" label="Previous" onPress={props.onPrevious} order={0} platform={props.platform} />
    <TransportButton disabled={!props.canSeek} focusId="player:transport:seek-back" id="playback.seek-back" label="Seek back" onPress={props.onSeekBack} order={1} platform={props.platform} />
    <TransportButton disabled={props.canPlayPause === false} focusId={TV_PLAYER_FOCUS_ENTRY.transport} id={props.isPlaying ? 'playback.pause' : 'playback.play'} label={props.isPlaying ? 'Pause' : 'Play'} main onPress={props.onPlayPause} order={2} platform={props.platform} />
    <TransportButton disabled={!props.canSeek} focusId="player:transport:seek-forward" id="playback.seek-forward" label="Seek forward" onPress={props.onSeekForward} order={3} platform={props.platform} />
    <TransportButton disabled={!props.canNext} focusId="player:transport:next" id="playback.next" label="Next" onPress={props.onNext} order={4} platform={props.platform} />
  </View>;
  return props.platform === 'tv' && props.focusContainer
    ? <TVLogicalFocusContainerBoundary container={props.focusContainer}>{transport}</TVLogicalFocusContainerBoundary>
    : transport;
}

function TransportButton({disabled, focusId, id, label, main, onPress, order, platform}: {
  disabled?: boolean;
  focusId?: string;
  id: IconId;
  label: string;
  main?: boolean;
  onPress(): void;
  order: number;
  platform: 'mobile' | 'tv';
}) {
  const content = <PorticoIcon color={color.silver} id={id} size={main ? (platform === 'tv' ? 38 : 30) : platform === 'tv' ? 29 : 23} />;
  if (platform === 'tv') return <Focusable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} hasTVPreferredFocus={main} onPress={onPress} platform="tv" style={[styles.transportButton, styles.transportButtonTV, main && styles.transportMainTV]} focusedStyle={styles.focused} pressedStyle={styles.pressed} tvFocusBoundaryDirections={['down', 'up']} tvFocusId={focusId ?? `player:transport:${id}`} tvFocusOrder={order}>{content}</Focusable>;
  return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} hitSlop={8} onPress={onPress} style={({pressed}) => [styles.transportButton, main && styles.transportMain, disabled && styles.disabled, pressed && styles.pressed]}>{content}</Pressable>;
}

type IconId = Extract<PorticoIconId,
  'playback.next' | 'playback.pause' | 'playback.play' | 'playback.previous' | 'playback.seek-back' | 'playback.seek-forward'>;

export function MobileAudioPresenter({artwork, bottom, expanded, onExpand, testID, title, subtitle, ...transport}: Omit<TransportProps, 'platform'> & {
  artwork?: string;
  bottom?: number;
  expanded: boolean;
  onExpand(): void;
  subtitle?: string;
  testID?: string;
  title: string;
}) {
  return <View style={[styles.mobileAudio, expanded && styles.mobileAudioExpanded, bottom !== undefined && {bottom}]} testID={testID ?? "portico-mobile-audio-presenter"}>
    <Pressable accessibilityLabel={expanded ? 'Collapse artwork' : 'Expand artwork'} accessibilityRole="button" onPress={onExpand} style={[styles.mobileAudioIdentity, expanded && styles.mobileAudioIdentityExpanded]}>
      {artwork ? <Image resizeMode="cover" source={{uri: artwork}} style={[styles.mobileArtwork, expanded && styles.mobileArtworkExpanded]} /> : <View style={[styles.mobileArtwork, styles.artworkFallback]}><PorticoIcon color={color.softSilver} id="media.music" size={36} /></View>}
      <View style={styles.copy}><Text numberOfLines={1} style={styles.mobileTitle}>{title}</Text>{subtitle ? <Text numberOfLines={1} style={styles.mobileSubtitle}>{subtitle}</Text> : null}</View>
    </Pressable>
    <FiveControlTransport {...transport} platform="mobile" />
  </View>;
}

export function MobileVideoUtilityHeader({children, onCollapse}: {children?: React.ReactNode; onCollapse(): void}) {
  return <View style={styles.mobileVideoHeader} testID="portico-mobile-video-utility-header">
    <Pressable accessibilityLabel="Collapse player" accessibilityRole="button" hitSlop={8} onPress={onCollapse} style={styles.headerButton}><PorticoIcon color={color.silver} id="navigation.collapse" size={24} /></Pressable>
    <View style={styles.headerUtilities}>{children}</View>
  </View>;
}

export function NowPlayingFocusContainer({onOpen, snapshot, visible}: {
  onOpen(): void;
  snapshot?: PersistentPlaybackSnapshot;
  visible: boolean;
}) {
  if (!visible || !snapshot?.active || snapshot.mediaFamily !== 'audio' || snapshot.presentation !== 'background') return null;
  return <Focusable accessibilityLabel={`Now Playing. ${snapshot.title}${snapshot.subtitle ? `. ${snapshot.subtitle}` : ''}`} accessibilityRole="button" onPress={onOpen} platform="tv" style={styles.nowPlaying} focusedStyle={styles.nowPlayingFocused} pressedStyle={styles.pressed} tvFocusId="player:now-playing">
    {snapshot.artwork ? <Image resizeMode="cover" source={{uri: snapshot.artwork}} style={styles.nowPlayingArtwork} /> : <View style={[styles.nowPlayingArtwork, styles.artworkFallback]}><PorticoIcon color={color.softSilver} id="media.music" size={28} /></View>}
    <View style={styles.nowPlayingCopy}><Text style={styles.nowPlayingEyebrow}>NOW PLAYING</Text><ContainedMarqueeText text={snapshot.title} variant="title" />{snapshot.subtitle ? <ContainedMarqueeText text={snapshot.subtitle} variant="subtitle" /> : null}</View>
  </Focusable>;
}

function ContainedMarqueeText({text, variant}: {text: string; variant: 'subtitle' | 'title'}) {
  const offset = useRef(new Animated.Value(0)).current;
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    offset.stopAnimation();
    offset.setValue(0);
    const travel = Math.max(0, contentWidth - containerWidth);
    if (!travel || reducedMotion) return undefined;
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(1400),
      Animated.timing(offset, {duration: Math.max(2400, travel * 45), toValue: -travel, useNativeDriver: true}),
      Animated.delay(900),
      Animated.timing(offset, {duration: 250, toValue: 0, useNativeDriver: true}),
    ]));
    animation.start();
    return () => animation.stop();
  }, [containerWidth, contentWidth, offset, reducedMotion, text]);
  return <View onLayout={event => setContainerWidth(event.nativeEvent.layout.width)} style={styles.marquee}><Animated.Text numberOfLines={1} onTextLayout={event => setContentWidth(event.nativeEvent.lines[0]?.width ?? 0)} style={[variant === 'title' ? styles.nowPlayingTitle : styles.nowPlayingSubtitle, contentWidth > containerWidth && {width: contentWidth}, {transform: [{translateX: offset}]}]}>{text}</Animated.Text></View>;
}

const styles = StyleSheet.create({
  artworkFallback: {alignItems: 'center', backgroundColor: color.brightSlate, justifyContent: 'center'},
  copy: {flex: 1, minWidth: 0},
  disabled: {opacity: 0.32},
  focused: {backgroundColor: color.focus, transform: [{scale: 1.06}]},
  headerButton: {alignItems: 'center', borderRadius: 24, height: 44, justifyContent: 'center', width: 44},
  headerUtilities: {alignItems: 'center', flexDirection: 'row', gap: 6},
  marquee: {overflow: 'hidden', width: '100%'},
  mobileArtwork: {borderRadius: 8, height: 56, width: 56},
  mobileArtworkExpanded: {aspectRatio: 1, height: undefined, width: '100%'},
  mobileAudio: {backgroundColor: color.recess, borderColor: color.line, borderRadius: 14, borderWidth: 1, bottom: 24, gap: 14, left: 16, padding: 14, position: 'absolute', right: 16, zIndex: 7},
  mobileAudioExpanded: {bottom: 16, paddingTop: 20},
  mobileAudioIdentity: {alignItems: 'center', flexDirection: 'row', gap: 12},
  mobileAudioIdentityExpanded: {alignItems: 'stretch', flexDirection: 'column'},
  mobileSubtitle: {color: color.softSilver, fontFamily: font.regular, fontSize: 13, marginTop: 3},
  mobileTitle: {color: color.silver, fontFamily: font.demi, fontSize: 16},
  mobileVideoHeader: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', left: 16, position: 'absolute', right: 16, top: 12, zIndex: 8},
  nowPlaying: {alignItems: 'center', backgroundColor: color.recess, borderColor: color.line, borderRadius: 10, borderWidth: 2, flexDirection: 'row', minHeight: 86, padding: 8, position: 'absolute', right: 60, top: 42, width: 420},
  nowPlayingArtwork: {borderRadius: 6, height: 68, width: 68},
  nowPlayingCopy: {flex: 1, marginLeft: 14, minWidth: 0},
  nowPlayingEyebrow: {color: color.screenBlue, fontFamily: font.demi, fontSize: 11, letterSpacing: 1.2},
  nowPlayingFocused: {backgroundColor: color.brightSlate, borderColor: color.focus, transform: [{scale: 1.025}]},
  nowPlayingSubtitle: {color: color.softSilver, fontFamily: font.regular, fontSize: 16, marginTop: 3},
  nowPlayingTitle: {color: color.silver, fontFamily: font.demi, fontSize: 21, marginTop: 2},
  pressed: {opacity: 0.82},
  transport: {alignItems: 'center', flexDirection: 'row', justifyContent: 'center'},
  transportButton: {alignItems: 'center', borderRadius: 28, height: 48, justifyContent: 'center', width: 48},
  transportButtonTV: {borderColor: color.transparent, borderWidth: 3, height: 64, width: 64},
  transportMain: {backgroundColor: color.brightSlate, height: 58, width: 58},
  transportMainTV: {height: 80, width: 80},
  transportTV: {gap: 8},
});
