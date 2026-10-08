import React, {useEffect, useRef, useState} from 'react';
import {Keyboard, Modal, PanResponder, Platform, Pressable, ScrollView, TVFocusGuideView, View, type StyleProp, type ViewStyle} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming} from 'react-native-reanimated';
import {Button} from './Button';
import type {FocusableHandle} from './Focusable';
import {Icon, type IconName} from './Icon';
import {Field} from './Field';
import {ListRow, rowPaddingX} from './ListRow';
import {Text} from './Text';
import {alpha, spec, useSpecPlatform, useTheme} from './theme';
import {uiI18n} from './i18n';
import {presentError} from '../../../../packages/client-core/src/presentation/index';

/**
 * Overlay hand-off. A modal presented on iOS while another is still dismissing is not shown (or
 * goes away with it), so an opening overlay waits for every closing one to finish.
 */
const closingOverlays = new Set<number>();
const overlayWaiters = new Set<() => void>();
let overlaySeq = 0;
function useOverlayId(): number {
  const ref = useRef(0);
  if (!ref.current) ref.current = ++overlaySeq;
  return ref.current;
}
export function overlayClosing(id: number, closing: boolean) {
  if (closing) { closingOverlays.add(id); return; }
  closingOverlays.delete(id);
  if (closingOverlays.size) return;
  for (const run of [...overlayWaiters]) { overlayWaiters.delete(run); run(); }
}
/** Run `fn` once no overlay is closing; returns a cancel. */
export function afterOverlaysClose(fn: () => void): () => void {
  if (!closingOverlays.size) { fn(); return () => {}; }
  let done = false;
  const run = () => { if (done) return; done = true; overlayWaiters.delete(run); clearTimeout(fallback); fn(); };
  // Belt and braces: never wait longer than a dismissal can take.
  const fallback = setTimeout(run, 400);
  overlayWaiters.add(run);
  return () => { done = true; overlayWaiters.delete(run); clearTimeout(fallback); };
}

/** One footer action (CON-02 §4.1). */
export type OverlayAction = {label: string; onPress: () => void; loading?: boolean; disabled?: boolean; tone?: 'default' | 'destructive'};

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  /** Television and iPad: centred panel width. */
  width?: number;
  /** Bottom-anchored on handheld (default) or centred everywhere. */
  placement?: 'auto' | 'center' | 'side';
  /**
   * Phones only: `half` opens a bottom sheet at half the screen height, and dragging the grabber up
   * expands it to full height (drag down collapses, then dismisses). Default `full`.
   */
  detent?: 'half' | 'full';
  /**
   * CON-01: `picker` (choose and go; a ✕ off TV, no footer), `form` (Cancel + one primary, no ✕),
   * `acknowledge` (must be read: one primary, no ✕, no swipe/scrim/Menu dismissal).
   * Defaults to `form` when a footer or primary is given, otherwise `picker`.
   */
  kind?: 'form' | 'picker' | 'acknowledge';
  primary?: OverlayAction;
  /** `form` only; defaults to "Cancel". Pass null for no Cancel. */
  cancelLabel?: string | null;
  /** A ghost action at the leading edge of the footer ("Reset to default", "Clear all"). */
  leading?: OverlayAction;
  /** Legacy free-form footer; prefer primary / cancelLabel / leading. */
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scroll?: boolean;
  /** Called once the open animation has finished and the content is laid out (TV: move focus here, not on timers). */
  onShown?: () => void;
};

/**
 * The single overlay container (Sheet v2). Handheld: an opaque bottom sheet with a grabber that
 * can be dragged down to dismiss, and that rises above the keyboard; television/iPad: a centred
 * panel. Dismissal animates out, then restores focus to the invoking control (the Modal unmounts).
 */
export function Sheet({open, onClose, title, subtitle, children, width, placement = 'auto', detent = 'full', kind: requestedKind, primary, cancelLabel, leading, footer, style, scroll = true, onShown}: SheetProps) {
  const {colors, space, isTV, window, motion, metrics} = useTheme();
  const platform = useSpecPlatform();
  const o = spec.overlay;
  const insets = useSafeAreaInsets();
  // `side` is a trailing full-height panel on TV and iPad; on a phone it becomes the bottom sheet.
  const bottom = placement !== 'center' && !isTV && window.width < 700;
  const side = placement === 'side' && !bottom;
  const half = bottom && detent === 'half';
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const halfRef = useRef(half);
  halfRef.current = half;
  useEffect(() => { if (open) setExpanded(false); }, [open]);
  const kind = requestedKind ?? (primary || footer ? 'form' : 'picker');
  const dismissable = kind !== 'acknowledge';
  const dismiss = () => { if (dismissable) onClose(); };
  // Stay mounted through the exit animation (APL-SYS-06).
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const id = useOverlayId();
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  const shown = useRef(() => onShownRef.current?.()).current;
  useEffect(() => {
    if (open) {
      // iOS drops a modal presented while another is still being dismissed (a menu item that
      // opens a sheet): wait until every closing overlay has gone, then present.
      return afterOverlaysClose(() => {
        setMounted(true);
        drag.value = 0;
        progress.value = withTiming(1, {duration: motion.reduce ? 0 : o.motion.enterMs, easing: Easing.out(Easing.cubic)}, done => {
          if (done) runOnJS(shown)();
        });
      });
    }
    if (!mountedRef.current) return;
    overlayClosing(id, true);
    progress.value = withTiming(0, {duration: motion.reduce ? 0 : o.motion.exitMs, easing: Easing.out(Easing.cubic)}, done => {
      if (done) runOnJS(setMounted)(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  // Once the Modal has unmounted, give UIKit a moment to finish dismissing before the next one presents.
  useEffect(() => {
    // Never cancelled: a closing mark that outlived its sheet would hold every later overlay back.
    if (!mounted) setTimeout(() => overlayClosing(id, false), 80);
  }, [mounted, id]);
  useEffect(() => () => { if (mountedRef.current) { overlayClosing(id, true); setTimeout(() => overlayClosing(id, false), 120); } }, [id]);
  // IOS-SET-01: a sheet with a field rises above the keyboard.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    if (!bottom || !mounted) return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', e => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0));
    return () => { show.remove(); hide.remove(); };
  }, [bottom, mounted]);
  // Drag the grabber or header down to dismiss; below the threshold it springs back.
  const closeRef = useRef(dismiss);
  closeRef.current = dismiss;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => (g.dy > 6 || (halfRef.current && !expandedRef.current && g.dy < -6)) && Math.abs(g.dy) > Math.abs(g.dx),
      // Claim the drag before the title or a button inside the header does.
      onMoveShouldSetPanResponderCapture: (_, g) => (g.dy > 8 || (halfRef.current && !expandedRef.current && g.dy < -8)) && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_, g) => { drag.value = Math.max(0, g.dy); },
      onPanResponderRelease: (_, g) => {
        if (halfRef.current && !expandedRef.current && (g.dy < -24 || g.vy < -0.3)) setExpanded(true);
        else if (g.dy > 120 || g.vy > 1.2) { if (halfRef.current && expandedRef.current) setExpanded(false); else closeRef.current(); }
        drag.value = withSpring(0, {damping: 20, stiffness: 220});
      },
      onPanResponderTerminate: () => { drag.value = withSpring(0); },
    }),
  ).current;
  const shade = useAnimatedStyle(() => ({opacity: progress.value}));
  // overlaySpec.motion: a sheet fades in rising 24 pt; a centred panel fades in from 0.98 scale. Reduce Motion keeps the fade.
  const rise = motion.reduce ? 0 : o.motion.translate;
  const from = motion.reduce ? 1 : o.motion.scaleFrom;
  const panel = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: bottom ? [{translateY: (1 - progress.value) * rise + drag.value}] : side ? [{translateX: (1 - progress.value) * rise}] : [{scale: from + (1 - from) * progress.value}],
  }));
  if (!mounted) return null;
  // One inset for header, body and footer; the body pulls rows out by their own padding so row text lines up with the title (CON-02).
  const inset = o.inset[bottom ? 'phone' : platform === 'phone' ? 'tablet' : platform];
  const rowInset = rowPaddingX(platform);
  // TV: rows scale and draw their focus ring outside their bounds; keep room so the ring is never
  // flush against, or clipped by, the panel's edge.
  const contentPadX = isTV ? Math.max(inset - rowInset, metrics.focusRing + 12) : inset - rowInset;
  const contentPadY = isTV ? Math.max(space.sm, metrics.focusRing + 8) : space.sm;
  const panelWidth = bottom ? '100%' : side ? Math.min(width ?? o.sideWidth[platform === 'phone' ? 'tablet' : platform], window.width - space.xl) : Math.min(width ?? o.width[isTV ? 'lg' : 'md'][platform === 'phone' ? 'tablet' : platform], window.width - space.xl * 2);
  const fullHeight = Math.min(window.height * o.maxHeight.phone, window.height - keyboard - insets.top - space.lg);
  const radius = o.radius[platform];
  const showClose = !isTV && kind === 'picker';
  const cancel = kind === 'form' && cancelLabel !== null ? cancelLabel ?? uiI18n().t('action.cancel') : undefined;
  const destructive = primary?.tone === 'destructive';
  // A phone bottom sheet uses the phone footer size (52 pt), whatever the device (overlay spec).
  const footerSize = spec.overlay.footer.buttonSize[bottom ? 'phone' : platform];
  // The scaffold owns the footer (CON-02): a legacy `footer` wins; otherwise Cancel, leading and primary.
  const actions = !footer && (primary || leading || cancel) ? (
    isTV ? (
      // Television: primary first so it takes focus, then Cancel, leading last.
      <View style={{flexDirection: 'row', justifyContent: 'center', gap: space.md, flex: 1}}>
        {primary ? <Button variant={primary.tone === 'destructive' ? 'destructive' : 'primary'} label={primary.label} loading={primary.loading} disabled={primary.disabled} onPress={primary.onPress} hasTVPreferredFocus={primary.tone !== 'destructive'} /> : null}
        {cancel ? <Button variant="ghost" label={cancel} onPress={onClose} hasTVPreferredFocus={destructive} /> : null}
        {leading ? <Button variant="ghost" label={leading.label} loading={leading.loading} disabled={leading.disabled} onPress={leading.onPress} /> : null}
      </View>
    ) : (
      <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1}}>
        {leading ? <Button variant="ghost" size={footerSize} label={leading.label} loading={leading.loading} disabled={leading.disabled} onPress={leading.onPress} style={{marginLeft: -space.sm}} /> : null}
        <View style={{flex: 1}} />
        {cancel ? <Button variant="ghost" size={footerSize} label={cancel} onPress={onClose} /> : null}
        {primary ? <Button variant={primary.tone === 'destructive' ? 'destructive' : 'primary'} size={footerSize} label={primary.label} loading={primary.loading} disabled={primary.disabled} onPress={primary.onPress} /> : null}
      </View>
    )
  ) : null;
  const footerContent = actions ?? (footer ? <View style={{flex: 1, flexDirection: 'row', justifyContent: isTV ? 'center' : 'flex-end', gap: space.sm}}>{footer}</View> : null);
  const body = (
    <Animated.View
      style={[
        {
          width: panelWidth,
          ...(half ? {height: expanded || keyboard ? fullHeight : Math.min(fullHeight, Math.round(window.height * o.halfDetent))} : side ? {height: '100%' as const, paddingTop: isTV ? 0 : insets.top} : {maxHeight: bottom ? fullHeight : window.height * o.maxHeight[platform === 'phone' ? 'tablet' : platform]}),
          // X-16: opaque. Nothing from the page shows through, and no blur is needed.
          backgroundColor: colors.overlaySurface,
          borderColor: alpha(colors[o.border.color], o.border.alpha),
          borderWidth: o.border.width,
          borderRadius: radius,
          borderBottomLeftRadius: bottom ? 0 : radius,
          borderBottomRightRadius: bottom || side ? 0 : radius,
          borderTopRightRadius: side ? 0 : radius,
          borderRightWidth: side ? 0 : o.border.width,
          paddingBottom: bottom && !footerContent ? (keyboard ? space.md : insets.bottom + space.md) : 0,
          marginBottom: bottom ? keyboard : 0,
          overflow: 'hidden',
        },
        panel,
        style,
      ]}>
      <View {...(bottom && dismissable ? pan.panHandlers : {})}>
        {bottom ? (
          // The grabber is also a button: tapping it expands a half sheet (or collapses it), so the gesture is never the only way.
          <Pressable disabled={!half} onPress={() => setExpanded(e => !e)} hitSlop={{top: 16, bottom: 16, left: 40, right: 40}} accessibilityRole={half ? 'button' : undefined} accessibilityLabel={half ? uiI18n().t(expanded ? 'sheet.collapse' : 'sheet.expand') : undefined} style={{alignSelf: 'center', marginTop: o.grabber.top - 4, marginBottom: -4, paddingVertical: 4}}>
            <View style={{width: o.grabber.width, height: o.grabber.height, borderRadius: o.grabber.height / 2, backgroundColor: alpha(colors[o.grabber.color], o.grabber.alpha)}} />
          </Pressable>
        ) : null}
        {title ? (
          // CON-29 §4.1 header: title in the `heading` role, subtitle in `caption`
          // secondary, top padding the overlay inset, headerGap between them.
          <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: inset, paddingTop: inset, paddingBottom: space.sm, gap: space.md}}>
            <View style={{flex: 1, gap: o.headerGap[platform]}}>
              <Text variant="heading" lines={2}>{title}</Text>
              {subtitle ? <Text variant="caption" tone="secondary" lines={1}>{subtitle}</Text> : null}
            </View>
            {showClose ? <Button variant="ghost" icon="close" accessibilityLabel={uiI18n().t('action.close')} onPress={onClose} style={{marginRight: -space.sm}} /> : null}
          </View>
        ) : null}
      </View>
      {scroll ? (
        <ScrollView style={half || side ? {flex: 1} : {flexGrow: 0, flexShrink: 1}} contentContainerStyle={{paddingHorizontal: contentPadX, paddingVertical: contentPadY}} keyboardShouldPersistTaps="handled"
          // A half sheet expands as soon as its content is scrolled, like the system sheets.
          scrollEventThrottle={32} onScroll={half && !expanded ? e => { if (e.nativeEvent.contentOffset.y > 4) setExpanded(true); } : undefined}>
          {children}
        </ScrollView>
      ) : (
        <View style={{paddingHorizontal: contentPadX, paddingVertical: contentPadY, flexShrink: 1}}>{children}</View>
      )}
      {footerContent ? (
        // CON-02: an opaque footer band with a hairline, on the same inset as the title.
        <View style={{flexDirection: 'row', paddingHorizontal: inset, paddingTop: space.md, paddingBottom: (bottom && !keyboard ? insets.bottom : 0) + space.md, borderTopWidth: 1, borderTopColor: colors.lineSoft, backgroundColor: colors.overlaySurface}}>
          {footerContent}
        </View>
      ) : null}
    </Animated.View>
  );
  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} supportedOrientations={['portrait', 'landscape']}>
      <Animated.View style={[{flex: 1, backgroundColor: alpha(colors[o.scrim.color], o.scrim.alpha[bottom ? 'phone' : platform])}, shade]}>
        <Pressable style={{flex: 1}} onPress={dismiss} accessibilityLabel={uiI18n().t('action.dismiss')} focusable={false} />
      </Animated.View>
      <View pointerEvents="box-none" style={{position: 'absolute', inset: 0, alignItems: side ? 'flex-end' : 'center', justifyContent: bottom ? 'flex-end' : side ? 'flex-start' : 'center'}}>
        {isTV ? <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={side ? {height: '100%'} : undefined}>{body}</TVFocusGuideView> : body}
      </View>
    </Modal>
  );
}

/**
 * Confirmations (confirmationSpec, CON-06). Tier 1 (bounded loss: delete a profile, remove a
 * device, sign out everywhere): title "Verb object?", the consequence, Cancel and a destructive
 * button named with the verb, never "OK". Cancel is the safe default: it takes focus on
 * television, and Back/Menu cancels. Tier 2 (irreversible, server-wide) adds one field: "Type
 * {token} to confirm", where the token is a short human word. A step-up (password) can sit in
 * `children`, inside the same dialog.
 */
export function ConfirmSheet({open, onDismiss, title, consequence, confirmLabel, onConfirm, confirmToken, tone = 'destructive', ready = true, describeError, children}: {
  open: boolean;
  onDismiss: () => void;
  title: string;
  consequence?: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  /** Tier 2: the word to type. */
  confirmToken?: string;
  /** `default` for non-destructive checks (a normal primary, no typed field). */
  tone?: 'destructive' | 'default';
  /** False while a step-up in `children` is incomplete. */
  ready?: boolean;
  /** How a failure is worded; defaults to the shared error presentation. */
  describeError?: (error: unknown) => string;
  children?: React.ReactNode;
}) {
  const {space, isTV} = useTheme();
  const platform = useSpecPlatform();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) { setBusy(false); setFailure(''); setTyped(''); } }, [open]);
  const tokenOk = !confirmToken || typed.trim().toLowerCase() === confirmToken.toLowerCase();
  const confirm = async () => {
    setBusy(true);
    setFailure('');
    try { await onConfirm(); onDismiss(); } catch (e) {
      const presented = describeError ? describeError(e) : presentError(e, 'generic', {operation: 'action'}).body;
      setFailure(presented);
    } finally { setBusy(false); }
  };
  const pad = rowPaddingX(platform);
  return (
    <Sheet open={open} onClose={onDismiss} title={title} kind="form" placement={isTV ? 'center' : 'auto'}
      primary={{label: confirmLabel, tone: tone === 'destructive' ? 'destructive' : 'default', loading: busy, disabled: !ready || !tokenOk, onPress: () => void confirm()}}>
      <View style={{gap: space.md, paddingHorizontal: pad}}>
        {consequence ? <Text variant="body" tone="secondary">{consequence}</Text> : null}
        {children}
        {confirmToken ? <Field label={uiI18n().t('confirm.typeToConfirm', {token: confirmToken})} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} /> : null}
        {failure ? <Text variant="caption" tone="danger" accessibilityRole="alert">{failure}</Text> : null}
      </View>
    </Sheet>
  );
}

export type MenuItem = {
  id: string;
  label: string;
  icon?: IconName;
  detail?: string;
  destructive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** Visual separator above this item. */
  section?: string;
  /** APL-SYS-05: ask before running a destructive item. */
  confirm?: {title: string; body?: string; action: string};
};

/** Action menu built on Sheet: bounded list of rows, optional section labels. */
/**
 * menuSpec: destructive items go last, in a group of their own, whatever order the caller gave;
 * a section label starts each group.
 */
export function orderMenuItems(items: readonly MenuItem[]): readonly MenuItem[] {
  const safe = items.filter(i => !i.destructive);
  const risky = items.filter(i => i.destructive);
  if (!risky.length || !safe.length) return items;
  return [...safe, {...risky[0]!, section: risky[0]!.section ?? ''}, ...risky.slice(1)];
}

export function Menu({open, onClose, title, subtitle, items: given, onSelect}: {open: boolean; onClose: () => void; title?: string; subtitle?: string; items: readonly MenuItem[]; onSelect: (id: string) => void}) {
  const {space, colors, isTV} = useTheme();
  const platform = useSpecPlatform();
  const pad = rowPaddingX(platform);
  const items = orderMenuItems(given);
  const [confirming, setConfirming] = useState<MenuItem>();
  // TV: open on the current choice, or on the first row when nothing is chosen. The sheet's focus
  // guide claims whatever it finds first while the modal animates in (rows aren't focusable yet),
  // so the menu moves focus itself once the open animation has finished (hasTVPreferredFocus stays
  // as the first request).
  const selectedRow = useRef<FocusableHandle>(null);
  const firstRow = useRef<FocusableHandle>(null);
  const firstId = items.find(i => !i.disabled)?.id;
  const claimFocus = isTV ? () => (selectedRow.current ?? firstRow.current)?.focus() : undefined;
  useEffect(() => { if (!open) setConfirming(undefined); }, [open]);
  if (confirming?.confirm) {
    const {title: confirmTitle, body, action} = confirming.confirm;
    return <ConfirmSheet open={open} onDismiss={() => setConfirming(undefined)} title={confirmTitle} consequence={body} confirmLabel={action} onConfirm={() => { onSelect(confirming.id); onClose(); }} />;
  }
  return (
    <Sheet open={open} onClose={onClose} title={title} subtitle={subtitle} kind="picker" onShown={claimFocus}>
      {items.map((item, index) => (
        <View key={item.id}>
          {item.section !== undefined && index > 0 && !item.section ? <View style={{height: 1, backgroundColor: colors.lineSoft, marginHorizontal: spec.menu.separator.insetX[platform], marginVertical: spec.menu.separator.marginY[platform]}} /> : null}
          {item.section ? (
            <Text variant="label" tone="tertiary" style={{paddingHorizontal: pad, paddingTop: index === 0 ? space.xs : space.lg, paddingBottom: space.xs}}>
              {item.section}
            </Text>
          ) : null}
          <ListRow
            title={item.label}
            subtitle={item.detail}
            icon={item.icon}
            selected={item.selected}
            disabled={item.disabled}
            tone={item.destructive ? 'destructive' : 'default'}
            // A picker opens on the current choice, not the first row (TV).
            hasTVPreferredFocus={!!item.selected}
            focusRef={item.selected ? selectedRow : item.id === firstId ? firstRow : undefined}
            trailing={item.selected ? <Icon name="check" color={colors.accent} /> : undefined}
            onPress={() => {
              if (item.confirm) { setConfirming(item); return; }
              onSelect(item.id);
              onClose();
            }}
          />
        </View>
      ))}
    </Sheet>
  );
}

/** A window rectangle a dropdown opens from, as measured by the control. */
export type DropdownAnchor = {x: number; y: number; width: number; height: number};

/**
 * Anchored dropdown: the same rows as Menu, but hanging from the control that
 * opened it (the library title, a sort button) instead of rising as a sheet.
 * Opaque overlay surface (X-16) over a light scrim; tapping outside dismisses.
 */
export function Dropdown({open, onClose, anchor, items: given, onSelect, width = 280}: {open: boolean; onClose: () => void; anchor?: DropdownAnchor; items: readonly MenuItem[]; onSelect: (id: string) => void; width?: number}) {
  const {colors, space, window, motion} = useTheme();
  const platform = useSpecPlatform();
  const items = orderMenuItems(given);
  const dropdownId = useOverlayId();
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) { overlayClosing(dropdownId, true); setTimeout(() => overlayClosing(dropdownId, false), 120); }
    wasOpen.current = open;
  }, [open, dropdownId]);
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, {duration: motion.reduce ? 0 : motion.quick, easing: Easing.out(Easing.cubic)});
  }, [open, progress, motion]);
  const panel = useAnimatedStyle(() => ({opacity: progress.value, transform: [{translateY: (progress.value - 1) * 6}]}));
  if (!open || !anchor) return null;
  const panelWidth = Math.min(width, window.width - space.md * 2);
  const left = Math.max(space.md, Math.min(anchor.x, window.width - panelWidth - space.md));
  const below = anchor.y + anchor.height + space.xs;
  const maxHeight = Math.max(160, window.height - below - insets.bottom - space.lg);
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable style={{flex: 1, backgroundColor: alpha(colors.ink, 0.25)}} onPress={onClose} accessibilityLabel={uiI18n().t('action.dismiss')} focusable={false} />
      <Animated.View
        accessibilityRole="menu"
        style={[{position: 'absolute', left, top: below, width: panelWidth, maxHeight, backgroundColor: colors.overlaySurface, borderColor: alpha(colors.lineStrong, spec.overlay.border.alpha), borderWidth: 1, borderRadius: spec.menu.radius[platform], paddingVertical: spec.menu.padding[platform], overflow: 'hidden'}, panel]}>
        <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={{flexShrink: 1}}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal: space.xs}}>
          {items.map((item, index) => (
            <View key={item.id}>
              {item.section !== undefined && index > 0 && !item.section ? <View style={{height: 1, backgroundColor: colors.lineSoft, marginHorizontal: spec.menu.separator.insetX[platform], marginVertical: spec.menu.separator.marginY[platform]}} /> : null}
              {item.section ? <Text variant="label" tone="tertiary" style={{paddingHorizontal: rowPaddingX(platform), paddingTop: index === 0 ? space.xs : space.md, paddingBottom: space.xs}}>{item.section}</Text> : null}
              <ListRow title={item.label} subtitle={item.detail} icon={item.icon} selected={item.selected} disabled={item.disabled} tone={item.destructive ? 'destructive' : 'default'} hasTVPreferredFocus={item.selected} trailing={item.selected ? <Icon name="check" color={colors.accent} /> : undefined} onPress={() => { onSelect(item.id); onClose(); }} />
            </View>
          ))}
        </ScrollView>
        </TVFocusGuideView>
      </Animated.View>
    </Modal>
  );
}
