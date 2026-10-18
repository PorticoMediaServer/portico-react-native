import {useCallback, useEffect, useRef} from 'react';
import {focusReturn, type FocusPlace, type FocusReturn} from './focus-return';

/**
 * TV-PLAYER-03: one focusable control's side of focus coming back after playback, as `Focusable`
 * runs it (kept here, without the view, so tests run the same code).
 *
 * - A named control (`key`) is registered with its screen (`scope`) while it is mounted; its place
 *   is read when it is needed, so a card that moves in its row keeps one registration. A control
 *   whose name changes while it has focus (a row of a windowed list now showing another entry)
 *   is the control with focus under its new name.
 * - Every control reports taking focus, named or not, so playback started from an unnamed control
 *   never reuses the last named one. Inside a sheet or menu (`overlay`) a control is never named:
 *   the control the sheet was opened from keeps being the one playback came from.
 * - The registry's request reaches the native view a frame later (`nativeFocusRequest`), and only
 *   if the return still wants this control then.
 */
export function useFocusReturnBinding({tv, scope, key, place, overlay = false, request, registry = focusReturn}: {
  tv: boolean;
  scope: string;
  /** The control's name, undefined for an unnamed (or disabled) control. */
  key: string | undefined;
  place?: FocusPlace;
  /** The control is in a sheet or menu. */
  overlay?: boolean;
  /** Asks the native focus engine to focus the control, unless `still()` is false by the time it runs. */
  request: (still: () => boolean) => void;
  registry?: FocusReturn;
}): {onFocus: () => void; onBlur: () => void} {
  const named = tv && key && !overlay ? key : undefined;
  const placeNow = useRef<FocusPlace>({});
  placeNow.current = {row: place?.row, column: place?.column};
  const asking = useRef(request);
  asking.current = request;
  const focusedNow = useRef(false);
  useEffect(() => {
    if (!named) return;
    const off = registry.register(scope, named, {focus: still => asking.current(still)}, () => placeNow.current);
    if (focusedNow.current) registry.focused(scope, named);
    return off;
  }, [named, scope, registry]);
  const onFocus = useCallback(() => {
    focusedNow.current = true;
    if (!tv) return;
    if (named) registry.focused(scope, named);
    else registry.focusedUnnamed(overlay);
  }, [tv, named, scope, overlay, registry]);
  const onBlur = useCallback(() => {
    focusedNow.current = false;
    if (named) registry.blurred(scope, named);
  }, [named, scope, registry]);
  return {onFocus, onBlur};
}

/**
 * Focusable's request: on the next frame (so a freshly mounted control has finished layout before
 * the focus engine looks at it), and only if the return that asked still wants this control then:
 * a key pressed, the screen left, the viewer changed or the row reused for another entry since
 * leave focus where it is.
 */
export function nativeFocusRequest(view: () => unknown, frame: (run: () => void) => unknown = run => requestAnimationFrame(run)): (still: () => boolean) => void {
  return still => { frame(() => { if (still()) (view() as {requestTVFocus?: () => void} | null)?.requestTVFocus?.(); }); };
}

/** A sheet or menu that is up counts as one, from its first frame (so a press inside it already knows). */
export function useFocusOverlay(open: boolean, registry: FocusReturn = focusReturn): void {
  useEffect(() => {
    if (!open) return;
    registry.overlay(true);
    return () => registry.overlay(false);
  }, [open, registry]);
}
