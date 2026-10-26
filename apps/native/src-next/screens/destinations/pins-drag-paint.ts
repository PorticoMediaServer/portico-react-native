import {useMemo} from 'react';
import {useAnimatedStyle, useSharedValue} from 'react-native-reanimated';

/**
 * UI-thread paint for the pinned-row drag (FX-067). It owns only the visual
 * transform/opacity of the row being dragged and its floating overlay; the
 * authoritative drag model, `nativePinDrop`, moveable/busy admission and the
 * place/drop/cancel callbacks stay in the existing group code. A gesture writes
 * these shared values directly, so no React state or row model changes per
 * move, and nothing here can save or reorder pins.
 */
export function usePinDragPaint() {
  const baseY = useSharedValue(0), overlayY = useSharedValue(0), overlayHeight = useSharedValue(0), overlayOpacity = useSharedValue(0);
  const rowOpacity = useSharedValue(1);
  const overlayStyle = useAnimatedStyle(() => ({
    // One transform list: the measured base top plus finger translation, then
    // the authored overlay scale so neither replaces the other.
    transform: [{translateY: overlayY.value}, {scale: 1.02}],
    height: overlayHeight.value,
    opacity: overlayOpacity.value,
  }));
  const sourceRowStyle = useAnimatedStyle(() => ({opacity: rowOpacity.value}));
  /** Original measured row top/height, then the finger translation on top. */
  const begin = (y: number, height: number) => {
    'worklet';
    baseY.value = y;
    overlayY.value = y;
    overlayHeight.value = height;
    overlayOpacity.value = 1;
    rowOpacity.value = 0;
  };
  /** Worklet-safe: only moves the paint, never the drop target. */
  const move = (translationY: number) => {
    'worklet';
    overlayY.value = baseY.value + translationY;
  };
  /** Retires the paint (commit, cancel, removal, busy or unmount). */
  const end = () => {
    'worklet';
    overlayOpacity.value = 0;
    rowOpacity.value = 1;
  };
  // Stable for the life of the group: a new object per render would make a
  // cleanup effect retire the live paint on unrelated re-renders.
  return useMemo(() => ({begin, move, end, overlayStyle, sourceRowStyle}), [baseY, overlayY, overlayHeight, overlayOpacity, rowOpacity, overlayStyle, sourceRowStyle]);
}
