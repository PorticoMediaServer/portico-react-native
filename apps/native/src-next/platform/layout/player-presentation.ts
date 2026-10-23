export type PlayerRect = Readonly<{x: number; y: number; width: number; height: number}>;
export type PlayerWindow = Readonly<{width: number; height: number}>;
/** Geometry consumed from the posture publisher, never inferred from a device name. */
export type PlayerFold = Readonly<{
  bounds: Readonly<{left: number; top: number; right: number; bottom: number}>;
  orientation: 'vertical' | 'horizontal';
  state: 'flat' | 'half-opened';
}>;
export type PlayerPresentationInput = Readonly<{
  window: PlayerWindow;
  /** Only a report for the current window can reserve a hinge. */
  posture: Readonly<{status: 'available' | 'pending' | 'unavailable'; window: PlayerWindow | null; folds: readonly PlayerFold[]}>;
  docked: boolean;
  panelOpen: boolean;
}>;
export type PlayerPresentation = Readonly<{
  mode: 'docked' | 'full-window' | 'watch' | 'book' | 'tabletop';
  /** A docked surface continues to use its measured art slot, not a window-derived slot. */
  surface?: PlayerRect;
  picture?: PlayerRect;
  controls?: PlayerRect;
  content?: PlayerRect;
  details?: PlayerRect;
  panel?: PlayerRect;
  hingeBand?: PlayerRect;
  hideNavigation: boolean;
  hideStatusBar: boolean;
  controlsAutoHide: boolean;
}>;

const positive = (value: number) => Number.isFinite(value) && value > 0;
const rect = (x: number, y: number, width: number, height: number): PlayerRect => ({x, y, width, height});

/** tablet-play1/2: aspect-fit the picture; controls occupy the whole picture pane. */
export function letterboxPlayerPicture(pane: PlayerRect): PlayerRect {
  const width = Math.min(pane.width, pane.height * 16 / 9), height = width * 9 / 16;
  return rect(pane.x + (pane.width - width) / 2, pane.y + (pane.height - height) / 2, width, height);
}

function currentFold({window, posture}: PlayerPresentationInput): PlayerFold | undefined {
  if (posture.status !== 'available' || posture.window?.width !== window.width || posture.window.height !== window.height) return;
  const valid = posture.folds.filter(fold => {
    const b = fold.bounds;
    if (![b.left, b.top, b.right, b.bottom].every(Number.isFinite) || b.right < b.left || b.bottom < b.top) return false;
    // A hinge partitions the window only when both pages have positive space.
    return fold.orientation === 'vertical'
      ? b.top <= 0 && b.bottom >= window.height && b.left > 0 && b.right < window.width
      : b.left <= 0 && b.right >= window.width && b.top > 0 && b.bottom < window.height;
  });
  // Do not guess which hinge to use on an ambiguous multi-feature report.
  return valid.length === 1 ? valid[0] : undefined;
}

/** Q7 is presentation only. This function cannot navigate, mutate watch state or command an engine. */
export function resolvePlayerPresentation(input: PlayerPresentationInput): PlayerPresentation | undefined {
  const {window: {width, height}, docked, panelOpen} = input;
  if (!positive(width) || !positive(height)) return;
  if (docked) return {mode: 'docked', hideNavigation: false, hideStatusBar: false, controlsAutoHide: false};
  const fold = currentFold(input), whole = rect(0, 0, width, height);
  const common = {hideNavigation: true, hideStatusBar: false, controlsAutoHide: true};
  if (fold?.state === 'half-opened') {
    const b = fold.bounds;
    // foldable9: the physical fold plus16pt on each side is reserved in a half fold.
    if (fold.orientation === 'vertical') {
      const left = Math.max(0, b.left - 16), right = Math.min(width, b.right + 16);
      const surface = rect(0, 0, left, Math.min(height, left * 9 / 16)), content = rect(right, 0, width - right, height);
      return {...common, mode: 'book', surface, picture: surface, controls: surface, content,
        details: rect(0, surface.height, left, height - surface.height),
        panel: panelOpen ? content : undefined, hingeBand: rect(left, 0, right - left, height)};
    }
    const top = Math.max(0, b.top - 16), bottom = Math.min(height, b.bottom + 16);
    const surface = rect(0, 0, width, top), controls = rect(0, bottom, width, height - bottom);
    return {...common, mode: 'tabletop', surface, picture: letterboxPlayerPicture(surface), controls, content: controls,
      panel: panelOpen ? controls : undefined, hingeBand: rect(0, top, width, bottom - top), controlsAutoHide: false};
  }
  if (width <= height) {
    const surface = rect(0, 0, width, Math.min(height, width * 9 / 16));
    return {...common, mode: 'watch', surface, picture: surface, controls: surface,
      content: rect(0, surface.height, width, height - surface.height)};
  }
  let surface = whole, panel: PlayerRect | undefined;
  if (panelOpen) {
    if (fold?.orientation === 'vertical') {
      // Q7: the right page exactly; a flat crease does not split the unpanelled player.
      surface = rect(0, 0, fold.bounds.left, height);
      panel = rect(fold.bounds.right, 0, width - fold.bounds.right, height);
    } else {
      // tablet-play2. Narrow compact windows retain the phone sheet container.
      const panelWidth = width >= 700 ? 380 : 0;
      if (panelWidth) {surface = rect(0, 0, width - panelWidth, height); panel = rect(width - panelWidth, 0, panelWidth, height);}
    }
  }
  return {...common, mode: 'full-window', surface, picture: letterboxPlayerPicture(surface), controls: surface, panel, hideStatusBar: true};
}

function geometryKey(input: PlayerPresentationInput): string {
  const fold = currentFold(input);
  return JSON.stringify([input.window.width, input.window.height, fold?.orientation, fold?.state, fold?.bounds]);
}

/** notes/foldable9: fold, unfold or turn reveals controls for3s; panel/scroll events do not extend it. */
export function playerControlsRevealDeadline(previous: PlayerPresentationInput | undefined, next: PlayerPresentationInput, now: number, deadline = 0): number {
  if (!Number.isFinite(now) || !resolvePlayerPresentation(next)) return deadline;
  if (next.docked) return 0;
  return previous && geometryKey(previous) !== geometryKey(next) ? now + 3000 : deadline;
}
