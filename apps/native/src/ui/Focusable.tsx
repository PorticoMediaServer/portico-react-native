import React, {forwardRef, useCallback, useImperativeHandle, useRef, useState} from 'react';
import {Pressable, TVFocusGuideView, View, type PressableProps, type StyleProp, type ViewStyle} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withTiming, Easing, type SharedValue} from 'react-native-reanimated';
import {useTheme} from './theme';

export type FocusableState = {focused: boolean; hovered: boolean; pressed: boolean};

export type FocusableProps = Omit<PressableProps, 'children' | 'style'> & {
  children: React.ReactNode | ((state: FocusableState) => React.ReactNode);
  style?: StyleProp<ViewStyle>;
  /** Corner radius used for the focus ring so it hugs the child's shape. */
  radius?: number;
  /** Override the platform focus scale (1 disables). */
  scale?: number;
  /** Draw the television focus ring. Defaults on for TV. */
  ring?: boolean;
  onStateChange?: (state: FocusableState) => void;
  /**
   * Working (a button's spinner, a PIN being checked): stays focusable, so focus never jumps away
   * on TV, but ignores presses and looks unavailable. Use `disabled` only for what can't be used at all.
   */
  busy?: boolean;
};

/** `node` is the native view, for a focus guide's `destinations`. */
export type FocusableHandle = {focus(): void; node?: () => View | null};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * TV: a container (a Shelf with `preferFocus`) can ask the control rendered inside it to claim
 * initial focus without the item renderer knowing. An explicit `hasTVPreferredFocus` wins.
 */
export const PreferredFocusContext = React.createContext(false);

/**
 * The one interaction primitive. Owns focus (television), hover (pointer on
 * iPad), press, and the shared scale/ring animation so that every card,
 * button, row and tab feels identical. Components never call Pressable
 * directly.
 */
export const Focusable = forwardRef<FocusableHandle, FocusableProps>(function Focusable(
  {children, style, radius = 8, scale, ring, disabled, busy = false, onFocus, onBlur, onHoverIn, onHoverOut, onPressIn, onPressOut, onStateChange, onPress, onLongPress, ...rest},
  ref,
) {
  const {isTV, metrics, motion} = useTheme();
  const preferred = React.useContext(PreferredFocusContext);
  const inner = useRef<View>(null);
  // RN's View exposes requestTVFocus (not focus); the next frame lets a
  // freshly mounted target finish layout before the focus engine looks at it.
  useImperativeHandle(ref, () => ({focus: () => { requestAnimationFrame(() => (inner.current as {requestTVFocus?: () => void} | null)?.requestTVFocus?.()); }, node: () => inner.current}), []);
  const [state, setState] = useState<FocusableState>({focused: false, hovered: false, pressed: false});
  const focusScale = scale ?? metrics.focusScale;
  const progress = useSharedValue(0);
  const press = useSharedValue(0);
  const update = useCallback(
    (patch: Partial<FocusableState>) => {
      setState(prev => {
        const next = {...prev, ...patch};
        onStateChange?.(next);
        return next;
      });
    },
    [onStateChange],
  );
  const timing = {duration: motion.reduce ? 0 : motion.quick, easing: Easing.out(Easing.cubic)};
  const animated = useAnimatedStyle(() => {
    const lift = 1 + (focusScale - 1) * progress.value;
    const pressed = 1 - (1 - metrics.pressScale) * press.value;
    return {transform: [{scale: lift * pressed}]};
  });
  const showRing = ring ?? isTV;
  return (
    <AnimatedPressable
      ref={inner as any}
      disabled={disabled}
      focusable={!disabled}
      tvParallaxProperties={{enabled: false}}
      hasTVPreferredFocus={preferred || undefined}
      onFocus={e => {
        progress.value = withTiming(1, timing);
        update({focused: true});
        onFocus?.(e);
      }}
      onBlur={e => {
        progress.value = withTiming(0, timing);
        update({focused: false});
        onBlur?.(e);
      }}
      onHoverIn={e => {
        progress.value = withTiming(isTV ? 1 : 0.6, timing);
        update({hovered: true});
        onHoverIn?.(e);
      }}
      onHoverOut={e => {
        progress.value = withTiming(state.focused ? 1 : 0, timing);
        update({hovered: false});
        onHoverOut?.(e);
      }}
      onPress={busy ? undefined : onPress}
      onLongPress={busy ? undefined : onLongPress}
      onPressIn={e => {
        if (busy) return;
        press.value = withTiming(1, {duration: motion.reduce ? 0 : 90});
        update({pressed: true});
        onPressIn?.(e);
      }}
      onPressOut={e => {
        press.value = withTiming(0, {duration: motion.reduce ? 0 : motion.quick});
        update({pressed: false});
        onPressOut?.(e);
      }}
      {...rest}
      style={[animated, style, disabled ? {opacity: 0.45} : busy ? {opacity: 0.6} : null]}>
      {typeof children === 'function' ? children(state) : children}
      {showRing ? <FocusRing progress={progress} radius={radius} /> : null}
    </AnimatedPressable>
  );
});

/**
 * PERF-S11: the ring's animated style lives here, so a Focusable without a ring (every Card) pays
 * for no second mapper.
 */
function FocusRing({progress, radius}: {progress: SharedValue<number>; radius: number}) {
  const {metrics, colors} = useTheme();
  const style = useAnimatedStyle(() => ({opacity: progress.value}));
  const inset = -(metrics.focusRing + 2);
  return <Animated.View pointerEvents="none" style={[{position: 'absolute', top: inset, left: inset, right: inset, bottom: inset, borderRadius: radius + metrics.focusRing + 2, borderWidth: metrics.focusRing, borderColor: colors.focus}, style]} />;
}

/**
 * A region that remembers where focus was. Leaving it and coming back returns to the control
 * that was last used inside it, not to whichever one happens to be nearest; the first arrival
 * goes to its first control (as a tvOS collection with a remembered index does). An earlier
 * version left the first arrival to geometry by turning `autoFocus` off until then, but a guide
 * without `autoFocus` is itself focusable and focus could land on the empty container.
 * Off television it renders its children and nothing else.
 */
export function FocusGroup({children, style, trapRight}: {children: React.ReactNode; style?: StyleProp<ViewStyle>; trapRight?: boolean}) {
  const {isTV} = useTheme();
  if (!isTV) return style ? <View style={style}>{children}</View> : <>{children}</>;
  // Always `autoFocus`: a guide without it is itself a focus target on tvOS, so the engine could
  // land on the empty container (seen as "Focused" in the accessibility tree). With it, entering
  // the group goes to the child last focused there, else the first one.
  return (
    <TVFocusGuideView autoFocus trapFocusRight={trapRight} style={style}>
      {children}
    </TVFocusGuideView>
  );
}
