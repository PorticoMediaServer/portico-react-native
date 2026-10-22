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
import {selectionHaptic} from '../../platform/haptics';
import {commandAllowed, dockCommand, playbackPosition, progressOf, releaseAside, remoteSubtitle, seekTo, validRect} from './model';
import {alpha, DockFacts, dockStyles as s, dockType} from './visual';
import type {DockAction, DockRect, DockRenderProps, DockSlotAdmission, PlayerMorphController} from './types';

export type MediaBarProps = DockRenderProps & {
  onVideoSlot?: (rect: DockRect) => void;
  /** Host closes this while its ancestor moves; standalone bars have no presence transform. */
  slotAdmission?: DockSlotAdmission | null;
  onMenuOpenChange?: (open: boolean) => void;
  /** Live core ownership, including a replacement before React rerenders. */
  isCurrent?: () => boolean;
  morph?: PlayerMorphController;
  menuOpen?: boolean;
};

/** This chrome has no video element, segment input, prompt slot, queue preview, or volume. */
export function MediaBar({occupant, onAction, visible = true, onVideoSlot, slotAdmission, onMenuOpenChange, isCurrent, morph, menuOpen, style, testID}: MediaBarProps) {
  const theme = useTheme(), motion = useMotion(), t = defaultI18n.t;
  const bar = useRef<View>(null), art = useRef<View>(null), opener = useRef<View>(null), firstMenu = useRef<View>(null);
  const [internalMenu, setMenu] = useState(false);
  const menu = menuOpen ?? internalMenu;
  const width = useSharedValue(374), localX = useSharedValue(0), xOrigin = useSharedValue(0), held = useSharedValue(1), localFade = useSharedValue(1), words = useSharedValue(1);
  const {presentation: p, remote, playback} = occupant;
  const menuSource = useRef(playback.fence), menuRemote = useRef(remote?.id);
  const video = occupant.mode === 'video', wide = video || !!remote;
  const sharedPicture = video && morph?.dockMotionHosted === true, x = sharedPicture ? morph.dockX : localX, fade = sharedPicture ? morph.dockFade : localFade;
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
  const latest = useRef({occupant, onAction, visible, isCurrent});
  latest.current = {occupant, onAction, visible, isCurrent};
  const gestureTarget = useRef({occupant, visible, epoch: 1});
  const old = gestureTarget.current;
  if (!sameFence(old.occupant.playback.fence, playback.fence) || old.occupant.remote?.id !== remote?.id
    || old.occupant.remote?.sequence !== remote?.sequence || old.visible !== visible || old.occupant.mode !== occupant.mode) {
    gestureTarget.current = {occupant, visible, epoch: old.epoch + 1};
  }
  const gestureSource = gestureTarget.current;
  const lifetime = useSharedValue(gestureSource.epoch), run = useSharedValue(0), active = useSharedValue(false);
  const mounted = useRef(false), consumed = useRef(0);
  const hold = useRef<{source: typeof gestureSource; used: boolean} | null>(null);
  useEffect(() => {
    lifetime.value = gestureSource.epoch; run.value++; active.value = false; hold.current = null;
    cancelAnimation(x); cancelAnimation(fade); cancelAnimation(held);
    x.value = 0; fade.value = 1; held.value = 1;
    return () => {
      lifetime.value = -1; run.value++; active.value = false; hold.current = null;
      cancelAnimation(x); cancelAnimation(fade); cancelAnimation(held);
    };
  }, [gestureSource, lifetime, run, active, x, fade, held]);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const currentInteraction = useCallback(() => mounted.current && gestureTarget.current === gestureSource
    && latest.current.visible && latest.current.isCurrent?.() !== false, [gestureSource]);
  const dismissFromGesture = useCallback((version: number) => {
    if (!currentInteraction() || version !== run.value || consumed.current === version) return;
    consumed.current = version;
    const original = gestureSource.occupant;
    const terminalRemote = original.remote && ['stopped', 'replaced', 'error'].includes(original.remote.phase);
    const type = terminalRemote ? 'dismiss-remote' : original.remote ? 'stop' : 'close';
    changeMenu(false);
    if (commandAllowed(original, type)) latest.current.onAction(dockCommand(original, type));
  }, [changeMenu, gestureSource, currentInteraction, run]);
  const aside = useMemo(() => Gesture.Pan().enabled(visible).activeOffsetX([-10, 10]).failOffsetY([-12, 12])
    .onBegin(() => {
      if (!gestureSource.visible || lifetime.value !== gestureSource.epoch) return;
      run.value++; active.value = true;
      cancelAnimation(x); cancelAnimation(fade); fade.value = 1; xOrigin.value = x.value;
    })
    .onUpdate(event => {if (active.value && lifetime.value === gestureSource.epoch) x.value = xOrigin.value + event.translationX;})
    .onEnd((event, success) => {
      if (!success || !active.value || lifetime.value !== gestureSource.epoch) return;
      active.value = false;
      const direction = releaseAside(x.value, event.velocityX, width.value), version = run.value;
      if (direction) {
        const done = (finished?: boolean) => {if (finished && run.value === version && lifetime.value === gestureSource.epoch) runOnJS(dismissFromGesture)(version);};
        if (spring) x.value = withSpring(direction * width.value * 1.25, {...spring, velocity: event.velocityX}, done);
        else {x.value = 0; fade.value = withTiming(0, {duration: 160}, done);}
      } else if (spring) x.value = withSpring(0, {...spring, velocity: event.velocityX});
      else {x.value = 0; fade.value = withTiming(1, {duration: 160});}
    }).onFinalize((_event, success) => {
      if (!success && lifetime.value === gestureSource.epoch) {
        run.value++; active.value = false; cancelAnimation(x); cancelAnimation(fade);
        x.value = spring ? withSpring(0, spring) : 0; fade.value = 1;
      }
    }), [x, xOrigin, width, spring, fade, dismissFromGesture, visible, gestureSource, lifetime, run, active]);
  const gestures = useMemo(() => morph ? Gesture.Race(aside, morph.dockGesture) : aside, [aside, morph]);
  // Local video uses the single ancestor shared with its native picture. Applying
  // x/fade here too would double the chrome's movement and opacity.
  const animated = useAnimatedStyle(() => ({opacity: sharedPicture ? 1 : fade.value, transform: [{translateX: sharedPicture ? 0 : x.value}, {scale: held.value}]}));
  const beginHold = useCallback(() => {
    if (!currentInteraction()) return;
    hold.current = {source: gestureSource, used: false};
    held.value = motion.transforms ? withTiming(.98, motion.timing('quick')) : 1;
  }, [currentInteraction, gestureSource, held, motion]);
  const endHold = useCallback(() => {
    if (hold.current?.source !== gestureSource) return;
    hold.current = null;
    held.value = motion.transforms ? withSpring(1, motion.spring('snap')) : 1;
  }, [gestureSource, held, motion]);
  const heldMenu = useCallback(() => {
    const pending = hold.current;
    if (!currentInteraction() || remote || !pending || pending.source !== gestureSource || pending.used) return;
    pending.used = true;
    held.value = motion.transforms ? withSpring(1.02, motion.spring('snap')) : 1;
    void selectionHaptic();
    changeMenu(true);
  }, [currentInteraction, remote, gestureSource, held, motion, changeMenu]);
  const textMotion = useAnimatedStyle(() => ({opacity: words.value, transform: [{translateY: motion.transforms ? 6 * (1 - words.value) : 0}]}));
  const slotSource = useRef(playback.fence);
  if (!sameFence(slotSource.current, playback.fence)) slotSource.current = playback.fence;
  const measuredFence = slotSource.current;
  const measurement = useRef(0), measuring = useRef(false);
  const slotNow = useRef({video, visible, onVideoSlot, slotAdmission, fence: playback.fence});
  slotNow.current = {video, visible, onVideoSlot, slotAdmission, fence: playback.fence};
  useEffect(() => {
    const request = measurement, live = measuring;
    live.current = true;
    return () => {live.current = false; request.current++;};
  }, []);
  const measureArt = useCallback(() => {
    const version = ++measurement.current, node = art.current;
    if (!measuring.current || active.value || x.value !== 0 || fade.value !== 1 || held.value !== 1 || !video || !visible || !onVideoSlot || !node || slotAdmission === null || slotAdmission?.isCurrent() === false) return;
    node.measureInWindow((ax, ay, w, h) => {
      const now = slotNow.current, rect = {x: ax, y: ay, width: w, height: h};
      if (measuring.current && !active.value && x.value === 0 && fade.value === 1 && held.value === 1 && version === measurement.current && node === art.current && now.video && now.visible &&
        now.onVideoSlot === onVideoSlot && now.slotAdmission === slotAdmission && sameFence(now.fence, measuredFence) &&
        slotAdmission?.isCurrent() !== false && validRect(rect)) onVideoSlot(rect);
    });
  }, [video, visible, onVideoSlot, slotAdmission, measuredFence, active, x, fade, held]);
  // Ancestor transforms do not produce a child onLayout at animation completion.
  useEffect(() => {
    const request = measurement;
    measureArt();
    return () => {request.current++;};
  }, [measureArt]);
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
          onPress={() => act(remote ? 'open-remote' : 'expand')} onLongPressAction={!remote ? heldMenu : undefined} delayLongPress={500}
          onPressIn={beginHold}
          onPressOut={endHold}
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
        disabled={!commandAllowed(occupant, row.action)}
        onPress={() => {changeMenu(false); act(row.action);}} style={{height: 42, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, borderTopWidth: index ? 1 : 0, borderTopColor: alpha(theme.colors.text, .06)}}>
        <Icon name={row.icon} size={20} color={row.id === 'stop' ? theme.colors.record : theme.colors.textSecondary}/><Text style={[dockType(theme, 14.5, 600), {color: theme.colors.text}]}>{row.label}</Text>
      </Focusable>)}
    </Popover>
  </>;
}

export const DockBar = MediaBar;
