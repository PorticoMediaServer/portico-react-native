import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Text, View, type LayoutChangeEvent} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming} from 'react-native-reanimated';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import {sameFence} from '../../../../../packages/player-core/src/index';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {Artwork} from '../artwork';
import {Button, Focusable} from '../controls';
import {Popover} from '../overlays';
import {Icon, type IconName} from '../Icon';
import {useTheme} from '../theme';
import {useMotion} from '../useMotion';
import {BlurView} from '../../platform/native-blur';
import {commandAllowed, dockCommand, playbackPosition, progressOf, releaseAside, remoteSubtitle, seekTo} from './model';
import {alpha, DockFacts, dockStyles as s, dockType} from './visual';
import type {DockAction, DockRect, DockRenderProps, PlayerMorphController} from './types';

export type MediaBarProps = DockRenderProps & {
  onVideoSlot?: (rect: DockRect) => void;
  onMenuOpenChange?: (open: boolean) => void;
  morph?: PlayerMorphController;
  menuOpen?: boolean;
};

/** This chrome has no video element, segment input, prompt slot, queue preview, or volume. */
export function MediaBar({occupant, onAction, visible = true, onVideoSlot, onMenuOpenChange, morph, menuOpen, style, testID}: MediaBarProps) {
  const theme = useTheme(), motion = useMotion(), t = defaultI18n.t;
  const bar = useRef<View>(null), art = useRef<View>(null), opener = useRef<View>(null), firstMenu = useRef<View>(null);
  const [internalMenu, setMenu] = useState(false);
  const menu = menuOpen ?? internalMenu;
  const width = useSharedValue(374), x = useSharedValue(0), xOrigin = useSharedValue(0), held = useSharedValue(1), fade = useSharedValue(1), words = useSharedValue(1);
  const {presentation: p, remote, playback} = occupant;
  const menuSource = useRef(playback.fence), menuRemote = useRef(remote?.id);
  const video = occupant.mode === 'video', wide = video || !!remote;
  const terminal = !!remote && ['stopped', 'replaced', 'error'].includes(remote.phase);
  const connecting = !!remote && ['connecting', 'pairing', 'waiting'].includes(remote.phase);
  const progress = progressOf(occupant);
  const act = useCallback((type: DockAction) => {if (commandAllowed(occupant, type)) onAction(dockCommand(occupant, type));}, [occupant, onAction]);
  const seekBack = useCallback(() => {
    const command = seekTo(occupant, playbackPosition(occupant) - p.skipBackSeconds);
    if (command) onAction(command);
  }, [occupant, p.skipBackSeconds, onAction]);
  const changeMenu = useCallback((open: boolean) => {setMenu(open); onMenuOpenChange?.(open);}, [onMenuOpenChange]);
  useEffect(() => () => onMenuOpenChange?.(false), [onMenuOpenChange]);
  useEffect(() => {
    if (!sameFence(menuSource.current, playback.fence) || menuRemote.current !== remote?.id) {changeMenu(false); x.value = 0; fade.value = 1;}
    menuSource.current = playback.fence; menuRemote.current = remote?.id;
  }, [playback.fence, remote?.id, changeMenu, x, fade]);
  useEffect(() => {words.value = 0; words.value = withTiming(1, motion.timing('standard'));}, [p.identity.title, playback.fence.sourceId, motion, words]);
  const dismiss = useCallback(() => act(terminal ? 'dismiss-remote' : remote ? 'stop' : 'close'), [act, terminal, remote]);
  const spring = useMemo(() => motion.spring('settle'), [motion]);
  const latest = useRef({occupant, onAction});
  latest.current = {occupant, onAction};
  const gestureTarget = useRef(occupant);
  if (!sameFence(gestureTarget.current.playback.fence, playback.fence) || gestureTarget.current.remote?.id !== remote?.id || gestureTarget.current.remote?.sequence !== remote?.sequence) gestureTarget.current = occupant;
  const gestureSource = gestureTarget.current;
  const dismissFromGesture = useCallback(() => {
    const original = gestureSource;
    const terminalRemote = original.remote && ['stopped', 'replaced', 'error'].includes(original.remote.phase);
    const type = terminalRemote ? 'dismiss-remote' : original.remote ? 'stop' : 'close';
    changeMenu(false);
    if (commandAllowed(original, type)) latest.current.onAction(dockCommand(original, type));
  }, [changeMenu, gestureSource]);
  const aside = useMemo(() => Gesture.Pan().activeOffsetX([-10, 10]).failOffsetY([-12, 12])
    .onBegin(() => {cancelAnimation(x); xOrigin.value = x.value;})
    .onUpdate(event => {x.value = xOrigin.value + event.translationX;})
    .onEnd(event => {
      const direction = releaseAside(x.value, event.velocityX, width.value);
      if (direction) {
        const done = (finished?: boolean) => {if (finished) runOnJS(dismissFromGesture)();};
        if (spring) x.value = withSpring(direction * width.value * 1.25, {...spring, velocity: event.velocityX}, done);
        else {x.value = 0; fade.value = withTiming(0, {duration: 160}, done);}
      } else if (spring) x.value = withSpring(0, {...spring, velocity: event.velocityX});
      else {x.value = 0; fade.value = withTiming(1, {duration: 160});}
    }).onFinalize((_event, success) => {if (!success) x.value = spring ? withSpring(0, spring) : 0;}), [x, xOrigin, width, spring, fade, dismissFromGesture]);
  const gestures = useMemo(() => morph ? Gesture.Race(aside, morph.gesture) : aside, [aside, morph]);
  const animated = useAnimatedStyle(() => ({opacity: fade.value, transform: [{translateX: x.value}, {scale: held.value}]}));
  const textMotion = useAnimatedStyle(() => ({opacity: words.value, transform: [{translateY: motion.transforms ? 6 * (1 - words.value) : 0}]}));
  const measureArt = useCallback(() => {
    if (video && onVideoSlot) art.current?.measureInWindow((ax, ay, w, h) => onVideoSlot({x: ax, y: ay, width: w, height: h}));
  }, [video, onVideoSlot]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {width.value = event.nativeEvent.layout.width; measureArt();}, [width, measureArt]);
  const label = remote ? t('next.dock.native.openRemote', {title: p.identity.title, device: p.device ?? t('cast.theTV')}) : t('next.dock.native.openPlayerLabel', {title: p.identity.title});
  const button = (type: DockAction, icon: IconName, name: string, size = 22, close = false, skip = false) => {
    const enabled = commandAllowed(occupant, type);
    return <Focusable key={type} accessibilityRole="button" accessibilityLabel={name} disabled={!enabled} focusRadius={20}
      hitSlop={{top: 2, bottom: 2, left: 0, right: 0}} style={[s.phoneButton, close && s.close, {opacity: enabled ? 1 : .32}]} onPress={() => skip ? seekBack() : act(type)}>
      <Icon name={icon} size={size} color={close ? theme.colors.textSecondary : theme.colors.text}/>
      {skip && <Text accessible={false} style={[dockType(theme, 8.5, 700), {position: 'absolute', color: theme.colors.text, top: 15}]}>{p.skipBackSeconds}</Text>}
    </Focusable>;
  };
  const playAction = p.finished ? 'replay' : playback.playing ? 'pause' : 'play';
  const playIcon = p.finished ? 'i-restart' : playback.playing ? 'i-pause' : 'i-play';
  const playLabel = p.finished ? t('player.post.replay') : t(playback.playing ? 'action.pause' : 'action.play');
  const subtitle = p.finished && !remote ? [{id: 'finished', text: t('player.post.finished'), role: 'status' as const}] : remoteSubtitle(occupant);
  const menuRows = [
    {id: 'open', icon: 'i-up' as const, label: t('next.dock.native.openPlayer'), action: 'expand' as const},
    ...(p.capabilities.cast ? [{id: 'cast', icon: 'i-cast' as const, label: t('next.dock.native.playOnMenu'), action: 'cast' as const}] : []),
    {id: 'stop', icon: 'i-stop' as const, label: t('action.stop'), action: 'close' as const},
  ];
  return <>
    <GestureDetector gesture={gestures}><Animated.View ref={bar} testID={testID} onLayout={onLayout} style={[{shadowColor: theme.colors.shadow, shadowOffset: {width: 0, height: menu ? 24 : 14}, shadowOpacity: .85, shadowRadius: 15}, animated, style]}>
      <View style={[s.phone, wide && s.video, {backgroundColor: alpha(theme.colors.raisedBright, .88), borderWidth: 1, borderColor: alpha(theme.colors.text, menu ? .12 : .07)}]}>
        <BlurView pointerEvents="none" style={s.fill} blurType="dark" blurAmount={24} reducedTransparencyFallbackColor={theme.colors.raisedBright}/>
        <Focusable ref={opener} focusTreatment="none" style={[s.body, {gap: wide ? 11 : 12}]} accessible={!connecting && !terminal} accessibilityRole={connecting || terminal ? undefined : 'button'} accessibilityLabel={connecting || terminal ? undefined : label}
          onPress={() => act(remote ? 'open-remote' : 'expand')} onLongPressAction={!remote ? () => {held.value = motion.transforms ? withSpring(1.02, motion.spring('snap')) : 1; changeMenu(true);} : undefined} delayLongPress={500}
          onPressIn={() => {held.value = motion.transforms ? withTiming(.98, motion.timing('quick')) : 1;}}
          onPressOut={() => {held.value = motion.transforms ? withSpring(1, motion.spring('snap')) : 1;}}
          accessibilityActions={[{name: 'activate', label: remote ? label : t('next.dock.native.openPlayer')}, {name: 'stop', label: t('action.stop')}]}
          onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'stop') dismiss(); else if (event.nativeEvent.actionName === 'activate') act(remote ? 'open-remote' : 'expand');}}>
          <View ref={art} collapsable={false} onLayout={measureArt} pointerEvents="none" style={[wide ? s.videoArt : s.art, {backgroundColor: theme.colors.shadow}]}>
            {!video && <Artwork source={p.artwork} width={wide ? 80 : 44} height={wide ? 45 : 44} visible={visible} priority imageStyle={{opacity: connecting || terminal ? .55 : 1}}/>}
            {video && <View style={[s.expand, {backgroundColor: alpha(theme.colors.dim, .62)}]}><Icon name="i-full" size={11}/></View>}
            {remote && <View style={[s.fill, s.center, {backgroundColor: alpha(theme.colors.dim, .55)}]}>{connecting ? <ActivityIndicator size={20} color={theme.colors.text}/> : <Icon name="i-tvdev" size={18}/>}</View>}
          </View>
          <Animated.View style={[s.text, textMotion]}><Text numberOfLines={1} ellipsizeMode="tail" style={[dockType(theme, 14.5, 700), {color: theme.colors.text}]}>{p.identity.title}</Text>
            <DockFacts parts={subtitle} style={{...dockType(theme, 12.5, 400), color: theme.colors.textSecondary}} gap={12}/>
          </Animated.View>
        </Focusable>
        {terminal ? <>
          {remote?.phase === 'stopped' && <Button variant="primary" size="small" accessibilityLabel={t('web.cast.continueHere', {position: clockText(playbackPosition(occupant)) ?? ''})}
            onPress={() => act('continue-here')} style={{height: 34, paddingHorizontal: 11, borderRadius: 9}} textStyle={dockType(theme, 13, 700)}>{t('next.dock.native.continueHere')}</Button>}
          {button('dismiss-remote', 'i-x', t('action.dismiss'), 18, true)}
        </> : <View style={s.transports}>
          {connecting ? button('stop', 'i-stop', t('next.dock.native.stopConnecting'), 20) : <>
            {video || remote ? button('seek', 'i-rew', t('player.skipBackSeconds', {seconds: p.skipBackSeconds}), 27, false, true) : button('previous', 'i-prev', p.previousLabel ?? t('player.previous'))}
            {button(playAction, playIcon, playLabel, 24)}
            {remote ? button('stop', 'i-stop', t('next.dock.native.stopRemote', {device: p.device ?? t('cast.theTV')}), 20) : button('next', 'i-next', p.nextLabel ?? t('player.next'))}
            {!remote && button('close', 'i-x', t('next.dock.native.stopClose'), 18, true)}
          </>}
        </View>}
        {!connecting && !terminal && progress !== undefined && <View pointerEvents="none" style={[s.line, {backgroundColor: alpha(theme.colors.text, .14)}]}><View style={{height: 2, width: `${progress * 100}%`, backgroundColor: wide ? theme.colors.accentStrong : theme.colors.text}}/></View>}
      </View>
    </Animated.View></GestureDetector>
    <Popover open={menu && !remote} onOpenChange={changeMenu} anchorRef={bar} returnFocusRef={opener} initialFocusRef={firstMenu} title={p.identity.title} modal backdropOpacity={0} placement="top-start" width={250} offset={8}
      style={{backgroundColor: theme.colors.raisedBright, borderRadius: 14}} contentStyle={{paddingVertical: 6}}>
      {menuRows.map((row, index) => <Focusable key={row.id} ref={index === 0 ? firstMenu : undefined} accessibilityRole="menuitem" accessibilityLabel={row.label}
        onPress={() => {changeMenu(false); act(row.action);}} style={{height: 42, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, borderTopWidth: index ? 1 : 0, borderTopColor: alpha(theme.colors.text, .06)}}>
        <Icon name={row.icon} size={20} color={row.id === 'stop' ? theme.colors.record : theme.colors.textSecondary}/><Text style={[dockType(theme, 14.5, 600), {color: theme.colors.text}]}>{row.label}</Text>
      </Focusable>)}
    </Popover>
  </>;
}

export const DockBar = MediaBar;
