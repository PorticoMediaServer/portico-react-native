import React, {forwardRef, useCallback, useEffect, useRef, useState} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BlurView, glassRecipe} from '../../platform/native-blur';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import {Icon} from '../Icon';
import {nativeType, useTheme} from '../theme';
import {Focusable} from '../controls/Focusable';
import {BottomSheet} from './BottomSheet';
import {OverlayPortal, useOverlayFrame, useOverlayLifecycle} from './OverlayHost';
import {popoverRect} from './geometry';
import {touchMenuRect} from '../browse/touch-menu-geometry';
import {alpha, FocusBoundary, useSurfaceMotion} from './surface';
import type {MenuProps, MenuRowProps, OverlayReason, PopoverProps} from './types';

export const MenuRow = forwardRef<View, MenuRowProps>(function MenuRow({label, icon, description, selected, destructive, tone = 'default', trailing, variant, style, onFocus, onBlur, onLongPress, onMenu, disabled, accessibilityLabel, accessibilityRole, accessibilityState, ...props}, ref) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const grouped = variant === 'grouped';
  const tv = theme.isTV || variant === 'tv';
  const ink = focused && tv ? theme.colors.ink : destructive ? theme.colors.record : selected === false && !grouped && !tv ? theme.colors.textSecondary : theme.colors.text;
  const iconColor = focused && tv ? theme.colors.ink : tone === 'owner' ? theme.colors.accentStrong : destructive ? theme.colors.record : theme.colors.textSecondary;
  return <Focusable {...props} focusKind="button" focusRadius={tv ? 14 : 8} onLongPressAction={onMenu} ref={ref} disabled={disabled} onLongPress={onLongPress}
    accessibilityRole={accessibilityRole ?? (selected !== undefined ? 'menuitem' : 'button')} accessibilityState={{selected, disabled: disabled ?? undefined, ...accessibilityState}} accessibilityLabel={accessibilityLabel ?? (typeof label === 'string' ? label : undefined)}
    onFocus={event => {setFocused(true); onFocus?.(event);}} onBlur={event => {setFocused(false); onBlur?.(event);}}
    hitSlop={props.hitSlop ?? (tv || grouped ? undefined : {top: 1, bottom: 1, left: 0, right: 0})} style={state => [{flexDirection: 'row', alignItems: 'center', gap: tv ? 14 : grouped ? 12 : 10, minHeight: tv ? 72 : grouped ? 48 : 42, paddingLeft: tv ? 28 : grouped ? 14 : 12, paddingRight: tv ? 28 : 14, paddingVertical: description ? 8 : 0, borderRadius: tv ? 14 : grouped ? 0 : 8, opacity: disabled ? 0.38 : 1, backgroundColor: focused && tv ? theme.colors.text : state.pressed ? alpha(theme.colors.text, 0.1) : tv ? alpha(theme.colors.text, 0.14) : tone === 'owner' && !grouped ? alpha(theme.colors.accent, 0.07) : 'transparent', borderWidth: 0}, typeof style === 'function' ? style(state) : style]}>
      {!icon && selected !== undefined && <View style={{width: tv ? 28 : 18}}>{selected && <Icon name="i-check" size={tv ? 28 : 18} color={theme.colors.accentStrong}/>}</View>}
      {icon && <View style={grouped && !tv ? {width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(tone === 'owner' ? theme.colors.accent : theme.colors.text, tone === 'owner' ? 0.16 : 0.08)} : undefined}><Icon name={icon} size={tv ? 28 : 18} color={iconColor}/></View>}
      <View style={{flex: 1, minWidth: 0}}><Text numberOfLines={1} style={[nativeType({size: tv ? 26 : grouped ? 15.5 : 15, weight: tv ? 700 : 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: ink}]}>{label}</Text>
        {description != null && <Text style={[theme.type.caption, {color: theme.colors.textTertiary, marginTop: 2}]}>{description}</Text>}
      </View>
      {typeof trailing === 'string' || typeof trailing === 'number' ? <Text style={[theme.type.captionStrong, {color: theme.colors.textTertiary}]}>{trailing}</Text> : trailing ?? (icon && selected ? <Icon name="i-check" size={tv ? 28 : 18} color={theme.colors.accentStrong}/> : undefined)}
    </Focusable>;
});

export function Popover({open, onOpenChange, anchorRef, title, headerContext, description, children, footer, initialFocusRef, returnFocusRef, accessibilityLabel, testID, style, contentStyle, titleType, titleTextStyle, descriptionTextStyle, width = 282, modal = false, holdFocus = modal, showTitle = false, backdropOpacity = 0, placement = 'bottom-end', offset = 6, dismissOnOutsidePress = true, touchContext = false}: PopoverProps & {touchContext?: boolean}) {
  const theme = useTheme();
  const viewport = useWindowDimensions();
  const hostFrame = useOverlayFrame();
  const insets = useSafeAreaInsets();
  const animation = useSurfaceMotion(open, 'menu');
  const progress = animation.progress;
  const backdropStyle = useAnimatedStyle(() => ({opacity: progress.value}));
  const [anchor, setAnchor] = useState<{x: number; y: number; width: number; height: number}>();
  const [height, setHeight] = useState(1);
  const dismiss = useCallback((reason: OverlayReason) => onOpenChange(false, reason), [onOpenChange]);
  useOverlayLifecycle(animation.present, modal, dismiss, initialFocusRef, returnFocusRef ?? anchorRef, animation.enterMs, testID);
  useEffect(() => {
    if (!open) return;
    let live = true, frame: number | undefined;
    const measure = () => {
      anchorRef.current?.measureInWindow((x, y, width, height) => {if (live) setAnchor(previous => previous && previous.x === x && previous.y === y && previous.width === width && previous.height === height ? previous : {x, y, width, height});});
      if (touchContext) frame = requestAnimationFrame(measure);
    };
    measure();
    return () => {live = false; if (frame !== undefined) cancelAnimationFrame(frame);};
  }, [open, anchorRef, viewport.width, viewport.height, insets.top, insets.bottom, insets.left, insets.right, touchContext]);
  if (!animation.present || !anchor) return null;
  const touchRect = touchContext ? touchMenuRect(anchor, viewport, height, insets) : undefined;
  const rect = touchRect ?? popoverRect(anchor, viewport, {width, height}, insets, placement, offset);
  const material = glassRecipe();
  const surface = <Animated.View testID={testID} accessibilityLabel={accessibilityLabel ?? (typeof title === 'string' ? title : undefined)} accessibilityViewIsModal={modal} onAccessibilityEscape={() => dismiss('escape')} style={[{position: 'absolute', left: rect.x - (modal ? 0 : hostFrame.x), top: rect.y - (modal ? 0 : hostFrame.y), width: rect.width, maxHeight: viewport.height - insets.top - insets.bottom - 16, borderRadius: touchContext ? 16 : 14, backgroundColor: alpha(theme.colors.raisedBright, material.nativeBlur ? 0.96 : 1), borderWidth: 1, borderColor: alpha(theme.colors.text, 0.1), overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.8, shadowOffset: {width: 0, height: 16}, shadowRadius: 30}, animation.style, style]}>
    {material.nativeBlur && <BlurView style={StyleSheet.absoluteFill} blurType="dark" blurAmount={30} reducedTransparencyFallbackColor={theme.colors.raisedBright} pointerEvents="none"/>}
    <FocusBoundary modal={holdFocus} testID={testID}><View onLayout={event => setHeight(event.nativeEvent.layout.height)} style={[{paddingVertical: touchContext ? 8 : 6}, contentStyle]}>
      {headerContext}
      {showTitle && title != null && <Text accessibilityRole="header" style={[titleType ? nativeType(titleType, theme.textScale) : theme.type.bodyStrong, {color: theme.colors.text, paddingHorizontal: 14, paddingVertical: 8}, titleTextStyle]}>{title}</Text>}
      {description != null && <Text style={[theme.type.caption, {color: theme.colors.textSecondary, paddingHorizontal: 14}, descriptionTextStyle]}>{description}</Text>}
      {children}{footer}
    </View></FocusBoundary>
  </Animated.View>;
  const pointer = touchRect && <View pointerEvents="none" style={{position: 'absolute', left: touchRect.side === 'right' ? rect.x - 7 : rect.x + rect.width - 7, top: rect.y + touchRect.arrowY - 7, width: 14, height: 14, borderRadius: 3, backgroundColor: theme.colors.raisedBright, transform: [{rotate: '45deg'}]}}/>;
  return modal ? <Modal transparent visible animationType="none" onRequestClose={() => dismiss('back')} statusBarTranslucent navigationBarTranslucent>
    <View style={{flex: 1}}><Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, backdropStyle]}>
      {touchContext ? [
        {left: 0, top: 0, right: 0, height: Math.max(0, anchor.y)},
        {left: 0, top: anchor.y + anchor.height, right: 0, bottom: 0},
        {left: 0, top: anchor.y, width: Math.max(0, anchor.x), height: anchor.height},
        {left: anchor.x + anchor.width, top: anchor.y, right: 0, height: anchor.height},
      ].map((rect, index) => <View key={index} style={{position: 'absolute', backgroundColor: alpha('#03080c', .58), ...rect}}/>) : <View style={[StyleSheet.absoluteFill, {backgroundColor: alpha(theme.colors.ink, backdropOpacity)}]}/>}
    </Animated.View><Pressable accessible={false} focusable={false} style={StyleSheet.absoluteFill} onPress={() => {if (dismissOnOutsidePress) dismiss('outside');}}/>{pointer}{surface}</View>
  </Modal> : <OverlayPortal rect={rect} onOutsidePress={dismissOnOutsidePress ? () => dismiss('outside') : undefined}>{surface}</OverlayPortal>;
}

export function Menu({items, open, onOpenChange, title, description, footer, initialFocusRef, returnFocusRef, accessibilityLabel, testID, style, contentStyle, titleType, titleTextStyle, descriptionTextStyle, anchorRef, width, presentation, initialFocusId, secondaryTitle, context, touchContext = false}: MenuProps & {touchContext?: boolean}) {
  const theme = useTheme(), viewport = useWindowDimensions();
  const first = useRef<View>(null);
  const actualPresentation = touchContext && !theme.isTV ? viewport.width < 600 ? 'sheet' : 'anchored' : presentation ?? (theme.isTV ? 'sideSheet' : anchorRef ? 'anchored' : 'sheet');
  const grouped = actualPresentation === 'sheet' || (actualPresentation === 'sideSheet' && !theme.isTV);
  if (actualPresentation === 'anchored' && !anchorRef) {if (open) throw new Error('An anchored menu requires an anchor ref.'); return null;}
  const rows = items.map((entry, index) => {
    if ('section' in entry) return <Text key={entry.id} style={[theme.type.captionStrong, {color: entry.tone === 'owner' ? theme.colors.accentStrong : theme.colors.textTertiary, marginHorizontal: theme.isTV ? 0 : 20, marginTop: 16, marginBottom: 8}]}>{entry.label}</Text>;
    if ('separator' in entry) return <View key={entry.id} style={grouped ? {height: 12} : {height: 1.5, backgroundColor: alpha(theme.colors.line, 0.9), marginHorizontal: 4, marginVertical: 6}}/>;
    const previousAction = items.slice(0, index).some(value => !('section' in value) && !('separator' in value) && !value.disabled);
    const initial = entry.id === initialFocusId || (!initialFocusId && !entry.disabled && !previousAction);
    const previous = items[index - 1];
    const next = items[index + 1];
    const groupStart = !previous || 'separator' in previous || 'section' in previous;
    const groupEnd = !next || 'separator' in next || 'section' in next;
    const corners = {borderTopLeftRadius: groupStart ? 14 : 0, borderTopRightRadius: groupStart ? 14 : 0, borderBottomLeftRadius: groupEnd ? 14 : 0, borderBottomRightRadius: groupEnd ? 14 : 0};
    return <View key={entry.id} style={[{marginHorizontal: grouped ? 16 : 0, marginBottom: actualPresentation === 'sideSheet' && theme.isTV ? 12 : 0, overflow: grouped ? 'hidden' : 'visible', backgroundColor: grouped ? theme.colors.raisedHigh : undefined}, corners]}>
      <MenuRow testID={testID ? `${testID}-item-${entry.id}` : undefined} focusId={entry.id} ref={initial ? first : undefined} variant={grouped ? 'grouped' : actualPresentation === 'sideSheet' ? 'tv' : 'compact'} style={touchContext && !grouped && !theme.isTV ? {minHeight: 44} : undefined} label={entry.label} description={entry.description} icon={entry.icon} disabled={entry.disabled} selected={entry.selected} destructive={entry.destructive} tone={entry.tone} onMenu={() => onOpenChange(false, 'back')} hasTVPreferredFocus={initial} onPress={() => {entry.onSelect(); if (entry.closeOnSelect !== false) onOpenChange(false, 'action');}}/>
      {grouped && !groupStart && <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 56, right: 0, height: 1, backgroundColor: alpha(theme.colors.lineStrong, 0.45)}}/>}
      {grouped && entry.tone === 'owner' && <View pointerEvents="none" style={[StyleSheet.absoluteFill, corners, {borderColor: alpha(theme.colors.accentStrong, 0.28), borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: groupStart ? 1 : 0, borderBottomWidth: groupEnd ? 1 : 0}]}/>}
    </View>;
  });
  const heading = secondaryTitle == null ? title : <>{title}{'  '}<Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{secondaryTitle}</Text></>;
  if (actualPresentation === 'anchored') return <Popover showTitle={touchContext} touchContext={touchContext} modal={touchContext && !theme.isTV ? true : undefined} backdropOpacity={touchContext ? .58 : 0} holdFocus={touchContext || theme.isTV} open={open} onOpenChange={onOpenChange} anchorRef={anchorRef!} width={touchContext ? 300 : width} title={title} description={description} titleType={titleType} titleTextStyle={titleTextStyle} descriptionTextStyle={descriptionTextStyle} footer={footer} initialFocusRef={initialFocusRef ?? first} returnFocusRef={returnFocusRef ?? anchorRef} accessibilityLabel={accessibilityLabel} testID={testID} style={style} contentStyle={contentStyle}><ScrollView keyboardShouldPersistTaps="handled">{rows}</ScrollView></Popover>;
  return <BottomSheet showClose={touchContext ? false : undefined} backdropOpacity={touchContext ? .58 : undefined} open={open} onOpenChange={onOpenChange} title={heading} description={description} titleType={titleType} titleTextStyle={titleTextStyle} descriptionTextStyle={descriptionTextStyle} width={touchContext ? undefined : width} footer={footer ?? (theme.isTV ? <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}><Text style={{color: theme.colors.text}}>{defaultI18n.t('action.back')}</Text>{'  '}{defaultI18n.t('action.close')}</Text> : undefined)} headerContext={context} initialFocusRef={initialFocusRef ?? first} returnFocusRef={returnFocusRef} accessibilityLabel={accessibilityLabel} testID={testID} style={style} contentStyle={contentStyle} fitContent>
    {rows}
  </BottomSheet>;
}
