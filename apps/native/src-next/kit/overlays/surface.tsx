import React, {useEffect, useRef, useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import Svg, {Defs, LinearGradient, RadialGradient, Rect, Stop} from 'react-native-svg';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import {Button} from '../controls/Button';
import {Focusable} from '../controls/Focusable';
import {FocusRegion} from '../focus';
import {Icon} from '../Icon';
import {nativeType, useTheme} from '../theme';
import {useMotion} from '../useMotion';
import {BottomSheet} from './BottomSheet';
import {OverlayPortal, useOverlayFrame, useOverlayLifecycle} from './OverlayHost';
import type {DialogProps, OverlayReason, SidePanelProps, SurfaceProps} from './types';

export function alpha(color: string, opacity: number): string {
  return `${color}${Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0')}`;
}
export function usePresence(open: boolean, exitMs: number) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {setPresent(true); return;}
    const timer = setTimeout(() => setPresent(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);
  return present || open;
}
export function useSurfaceMotion(open: boolean, kind: 'dialog' | 'menu' | 'side' | 'banner' | 'toast', width = 0) {
  const motion = useMotion();
  const {isTV} = useTheme();
  const exit = motion.reduce ? 160 : kind === 'side' && isTV ? 240 : 120;
  const duration = motion.reduce ? 160 : kind === 'side' ? 320 : 180;
  const progress = useSharedValue(0);
  useEffect(() => {progress.value = withTiming(open ? 1 : 0, {...motion.timing(open ? kind === 'side' ? 'slow' : 'standard' : 'quick', open ? 'out' : 'in'), duration: open ? duration : exit});}, [open, motion, progress, duration, exit, kind]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: motion.reduce ? [] : kind === 'side' ? [{translateX: (1 - progress.value) * (isTV ? width : 24)}] : kind === 'banner' ? [{translateY: (1 - progress.value) * -8}] : kind === 'toast' ? [{translateY: (1 - progress.value) * 24}] : [{translateY: (1 - progress.value) * (kind === 'menu' ? 4 : 0)}, {scale: (kind === 'menu' ? 0.96 : 0.98) + progress.value * (kind === 'menu' ? 0.04 : 0.02)}],
  }));
  return {motion, progress, style, present: usePresence(open, exit), enterMs: duration};
}

export function PanelBackground() {
  const {colors} = useTheme();
  return <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}><Svg width="100%" height="100%" accessible={false}>
    <Defs><LinearGradient id="panel-base" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#132836"/><Stop offset="1" stopColor="#0b1822"/></LinearGradient>
      <RadialGradient id="panel-blue" cx="100%" cy="0%" rx="120%" ry="50%"><Stop offset="0" stopColor={colors.accent} stopOpacity={0.34}/><Stop offset="0.7" stopColor={colors.accent} stopOpacity={0}/></RadialGradient></Defs>
    <Rect width="100%" height="100%" fill="url(#panel-base)"/><Rect width="100%" height="100%" fill="url(#panel-blue)"/>
  </Svg></View>;
}
function DialogBackground({radius}: {radius: number}) {
  const {isTV} = useTheme();
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, {borderRadius: radius, overflow: 'hidden'}]}><Svg width="100%" height="100%" accessible={false}>
    <Defs><LinearGradient id="dialog-base" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={isTV ? '#162c3a' : '#172d3b'}/><Stop offset="1" stopColor={isTV ? '#0f2230' : '#10212d'}/></LinearGradient></Defs>
    <Rect width="100%" height="100%" fill="url(#dialog-base)"/>
  </Svg></View>;
}
export function FocusBoundary({modal, children, style, testID}: {modal: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string}) {
  const {isTV} = useTheme();
  return isTV ? <FocusRegion id={testID ?? ''} hold={modal} style={style}>{children}</FocusRegion> : <View style={style}>{children}</View>;
}
export function SurfaceHeader({title, description, action, side = false, inset = true, dialog = false, titleType: suppliedType, titleTextStyle, descriptionTextStyle}: Pick<SurfaceProps, 'title' | 'description' | 'titleType' | 'titleTextStyle' | 'descriptionTextStyle'> & {action?: React.ReactNode; side?: boolean; inset?: boolean; dialog?: boolean}) {
  const theme = useTheme();
  const titleType = nativeType(suppliedType ?? {size: theme.isTV && side ? 46 : theme.isTV ? 42 : theme.platform === 'tablet' && !side ? 23 : 21, weight: 800, tracking: theme.isTV ? side ? -0.035 : -0.03 : dialog ? -0.025 : -0.02, lineHeight: theme.isTV ? side ? 47.84 : 47.04 : dialog ? 27.6 : 'normal'}, theme.textScale);
  return <View style={{paddingHorizontal: theme.isTV || !inset ? 0 : 20, paddingTop: dialog ? 0 : side && theme.isTV ? 18 : 2, paddingBottom: dialog ? 0 : 12}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}><Text accessibilityRole="header" style={[titleType, {color: theme.colors.text, flex: 1, paddingRight: dialog && !theme.isTV ? 40 : 0}, titleTextStyle]}>{title}</Text>{action}</View>
    {description != null && <Text style={[theme.isTV ? nativeType({size: side ? 22 : 26, lineHeight: side ? 33 : 39, weight: 400, tracking: 0}, theme.textScale) : nativeType({size: theme.platform === 'tablet' && !side ? 15 : 14, lineHeight: theme.platform === 'tablet' && !side ? 23.25 : 21, weight: 400, tracking: 0}, theme.textScale), {color: theme.colors.textSecondary, marginTop: dialog ? theme.isTV ? 14 : 8 : 6}, descriptionTextStyle]}>{description}</Text>}
  </View>;
}

function CenteredDialog({open, onOpenChange, title, headerContext, description, children, footer, initialFocusRef, returnFocusRef, accessibilityLabel, testID, style, contentStyle, titleType, titleTextStyle, descriptionTextStyle, width: suppliedWidth, size = 'md', dismissOnOutsidePress = true, dismissOnBack = true, showClose = true}: DialogProps) {
  const theme = useTheme();
  const animation = useSurfaceMotion(open, 'dialog');
  const closeRef = useRef<View>(null);
  const scrimStyle = useScrimStyle(animation.progress);
  const dismiss = (reason: OverlayReason) => {if ((reason !== 'back' && reason !== 'escape') || dismissOnBack) onOpenChange(false, reason);};
  useOverlayLifecycle(animation.present, true, dismiss, initialFocusRef ?? closeRef, returnFocusRef, animation.enterMs, testID);
  if (!animation.present) return null;
  const width = suppliedWidth ?? (size === 'md' ? theme.isTV ? 900 : 480 : theme.spec.overlay.width[size][theme.platform]);
  return <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => dismiss('back')} supportedOrientations={['portrait', 'landscape']}>
    <View style={styles.modalRoot} accessibilityViewIsModal importantForAccessibility="yes" onAccessibilityEscape={() => dismiss('escape')}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {backgroundColor: alpha(theme.isTV ? '#04090d' : '#03080c', theme.isTV ? 0.62 : 0.64)}, scrimStyle]}/>
      <Pressable accessible={false} focusable={false} style={StyleSheet.absoluteFill} onPress={() => {if (dismissOnOutsidePress) dismiss('outside');}}/>
      <Animated.View testID={testID} accessibilityLabel={accessibilityLabel} style={[{width: width || '100%', maxWidth: '92%', maxHeight: `${theme.spec.overlay.maxHeight[theme.platform] * 100}%`, borderRadius: theme.isTV ? 26 : 20, paddingTop: theme.isTV ? 48 : 26, paddingHorizontal: theme.isTV ? 52 : 26, paddingBottom: theme.isTV ? 44 : 22, backgroundColor: theme.colors.raised, borderWidth: 1, borderColor: alpha(theme.colors.text, 0.09)}, animation.style, style]}>
        <DialogBackground radius={theme.isTV ? 26 : 20}/>
        <FocusBoundary modal testID={testID}>
          {headerContext}
          <SurfaceHeader dialog inset={false} title={title} description={description} titleType={titleType} titleTextStyle={titleTextStyle} descriptionTextStyle={descriptionTextStyle}/>
          <View style={contentStyle}>{children}</View>
          {footer != null && <View style={{marginTop: theme.isTV ? 40 : 22, gap: theme.isTV ? 18 : 10}}>{footer}</View>}
        </FocusBoundary>
        {showClose && !theme.isTV && <Focusable testID={testID ? `${testID}-close` : undefined} focusId="close" ref={closeRef} focusRadius={18} accessibilityRole="button" accessibilityLabel={defaultI18n.t('action.close')} hitSlop={4} onPress={() => dismiss('close-button')} style={{position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center'}}><Icon name="i-close" size={20} color={theme.colors.textTertiary}/></Focusable>}
      </Animated.View>
    </View>
  </Modal>;
}
export function Dialog(props: DialogProps) {
  const theme = useTheme();
  return theme.platform === 'phone' || props.placement === 'side' ? <BottomSheet {...props} fitContent scrollable={false} /> : <CenteredDialog {...props}/>;
}
function useScrimStyle(progress: {value: number}) {
  return useAnimatedStyle(() => ({opacity: progress.value}));
}
export function SidePanel({open, onOpenChange, title, headerContext, description, children, footer, initialFocusRef, returnFocusRef, accessibilityLabel, testID, style, contentStyle, titleType, titleTextStyle, descriptionTextStyle, width, topInset = 76, closeOnOutsidePress = false, dismissOnBack = true, showClose = true, logicalCanvas}: SidePanelProps) {
  const theme = useTheme();
  const frame = useOverlayFrame();
  const viewport = useWindowDimensions();
  const hostWidth = frame.width || viewport.width;
  const hostHeight = frame.height || viewport.height;
  const canvas = theme.isTV && logicalCanvas && Number.isFinite(logicalCanvas.width) && logicalCanvas.width > 0 && Number.isFinite(logicalCanvas.height) && logicalCanvas.height > 0 ? logicalCanvas : undefined;
  const canvasScale = canvas ? Math.min(hostWidth / canvas.width, Math.max(0, hostHeight - topInset) / canvas.height) : 1;
  const actualWidth = canvas ? canvas.width * canvasScale : width ?? (theme.isTV ? 640 : 440);
  const animation = useSurfaceMotion(open, 'side', actualWidth);
  const closeRef = useRef<View>(null);
  const dismiss = (reason: OverlayReason) => {if ((reason !== 'back' && reason !== 'escape') || dismissOnBack) onOpenChange(false, reason);};
  useOverlayLifecycle(animation.present, false, dismiss, initialFocusRef ?? closeRef, returnFocusRef, animation.enterMs, testID);
  const panelWidth = Math.min(actualWidth, hostWidth);
  const rect = {x: frame.x + hostWidth - panelWidth, y: frame.y + topInset, width: panelWidth, height: Math.max(0, hostHeight - topInset)};
  if (!animation.present) return null;
  const padding = {paddingTop: theme.isTV ? 64 : 24, paddingBottom: theme.isTV ? 56 : 20, paddingLeft: theme.isTV ? 56 : 0, paddingRight: theme.isTV ? 96 : 0};
  const content = <>{theme.isTV && <PanelBackground/>}
      <FocusBoundary modal testID={testID} style={styles.root}>
        {headerContext}
        <SurfaceHeader side title={title} description={description} titleType={titleType} titleTextStyle={titleTextStyle} descriptionTextStyle={descriptionTextStyle} action={showClose ? <Button testID={testID ? `${testID}-close` : undefined} focusId="close" ref={closeRef} variant="text" size="small" onPress={() => dismiss('close-button')}>{defaultI18n.t('action.close')}</Button> : undefined}/>
        <View style={[styles.root, contentStyle]}>{children}</View>
        {footer != null && <View style={{paddingHorizontal: theme.isTV ? 0 : 20, paddingTop: 16}}>{footer}</View>}
      </FocusBoundary></>;
  return <OverlayPortal rect={rect} onOutsidePress={closeOnOutsidePress ? () => dismiss('outside') : undefined}>
    <Animated.View testID={testID} accessibilityLabel={accessibilityLabel} onAccessibilityEscape={() => dismiss('escape')} style={[styles.side, {top: topInset, width: actualWidth, maxWidth: '100%', backgroundColor: theme.colors.raised, zIndex: theme.layers.menu}, canvas ? undefined : padding, animation.style, canvas ? undefined : style]}>
      {canvas ? <View style={[padding, style, {position: 'absolute', top: 0, left: 0, width: canvas.width, height: canvas.height, transformOrigin: 'top left', transform: [{scale: canvasScale}]}]}>{content}</View> : content}
    </Animated.View>
  </OverlayPortal>;
}
const styles = StyleSheet.create({root: {flex: 1}, modalRoot: {flex: 1, justifyContent: 'center', alignItems: 'center'}, side: {position: 'absolute', right: 0, bottom: 0, shadowColor: '#000', shadowOffset: {width: -20, height: 0}, shadowOpacity: 0.6, shadowRadius: 40}});
