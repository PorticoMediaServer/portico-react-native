import React, {createContext, useContext, useMemo} from 'react';
import {AccessibilityInfo, Platform, useWindowDimensions, type TextStyle} from 'react-native';
import {cardScaleFor} from './card-scale';
export {cardScaleFor};
import {colors as designColors, radii as designRadii, motion as designMotion, layers as designLayers, typeScale, tvRadiusMultiplier, targets, componentSpec} from '../../../../packages/design/src/index';

/**
 * The single source of visual truth for the app. Every component in `ui/`
 * reads from here; nothing outside `ui/` may declare a colour, font or
 * spacing literal. Primitive values come from `packages/design`; this file
 * adds the platform scale (television vs handheld) and semantic roles.
 */
export const isTV: boolean = Platform.isTV === true;

/**
 * How a television's hidden text input is opened (see `Field`). tvOS presents the keyboard for a
 * first responder wherever it sits. On Android a view inside a container that refuses focus
 * cannot take it, so there the container lets focus in for as long as the keyboard is in use.
 */
export const inputFocusOnDemand: boolean = Platform.OS === 'android';

/**
 * How a scrolling form makes room for the keyboard. An iPhone or iPad pads by the keyboard's
 * height; an Apple TV's keyboard is its own full screen, so nothing moves. Android draws edge to
 * edge on phones and televisions alike, where the window is not resized for the keyboard, so
 * both pad.
 */
export const keyboardAvoidance: 'padding' | undefined = Platform.OS === 'ios' && isTV ? undefined : 'padding';

export const palette = {
  ...designColors,
  /** Surfaces */
  ink: designColors.ink, // canvas
  raised: designColors.raised, // panels, cards at rest
  raisedHigh: designColors.raisedHigh, // hovered / focused / selected surfaces
  raisedBright: designColors.raisedBright,
  raisedSoft: designColors.raisedSoft, // subdued containers
  /** X-16: every sheet, menu, dropdown and the expanded rail. Opaque. */
  overlaySurface: designColors.overlaySurface,
  /** Atmosphere */
  glow: designColors.ambient,
  glowStrong: designColors.raisedBright,
  /** Action */
  accent: designColors.accent,
  accentHover: designColors.accentStrong,
  accentDeep: designColors.accentDeep,
  accentInk: designColors.actionInk,
  /** Text */
  text: designColors.text,
  textSecondary: designColors.textSecondary,
  textTertiary: designColors.textTertiary,
  muted: designColors.muted,
  /** Lines */
  line: designColors.line,
  lineSoft: designColors.lineSoft,
  lineStrong: designColors.lineStrong,
  /** Boundary of a control at rest (fields). */
  lineControl: designColors.lineControl,
  /** Status */
  danger: designColors.danger,
  amber: designColors.amber,
  record: designColors.record,
  healthy: designColors.healthy,
  focus: designColors.focus,
  /** Overlays */
  scrim: designColors.scrim,
  material: designColors.material,
  shade: designColors.scrim,
  white: '#ffffff',
  black: '#000000',
} as const;

export type Palette = typeof palette;

/** Type roles. Numbers are point sizes; television is designed at 1920×1080. */
type Role = 'display' | 'title' | 'heading' | 'subheading' | 'body' | 'bodyStrong' | 'caption' | 'captionStrong' | 'micro' | 'label';
const family: Record<number, string> = {400: 'Manrope-Regular', 500: 'Manrope-Medium', 600: 'Manrope-SemiBold', 700: 'Manrope-Bold'};
/** Type roles from the shared scale (X-10): tracking is em, so letterSpacing = tracking × size. */
function typeRoles(scale: (typeof typeScale)['handheld']): Record<Role, TextStyle> {
  const out = {} as Record<Role, TextStyle>;
  for (const role of Object.keys(scale) as Role[]) {
    const t = scale[role];
    out[role] = {fontSize: t.size, lineHeight: t.lineHeight, fontFamily: family[t.weight] ?? 'Manrope-Regular', letterSpacing: Math.round(t.tracking * t.size * 100) / 100, ...(t.uppercase ? {textTransform: 'uppercase' as const} : null)};
  }
  return out;
}
const handheldType = typeRoles(typeScale.handheld);
const televisionType = typeRoles(typeScale.tenFoot);
/** APL-SYS-03 / A11Y-7.6: TV has no reliable system text scaling, so a device preference scales the ten-foot roles. */
function scaled(roles: Record<Role, TextStyle>, factor: number): Record<Role, TextStyle> {
  if (factor === 1) return roles;
  const out = {} as Record<Role, TextStyle>;
  for (const role of Object.keys(roles) as Role[]) {
    const t = roles[role];
    out[role] = {...t, fontSize: Math.round((t.fontSize ?? 0) * factor), lineHeight: t.lineHeight ? Math.round(t.lineHeight * factor) : undefined};
  }
  return out;
}

/** Spacing rhythm. Handheld runs on a 4pt grid, television on 8pt. */
const handheldSpace = {xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, page: 16, gutter: 12} as const;
const televisionSpace = {xxs: 4, xs: 8, sm: 12, md: 20, lg: 28, xl: 40, xxl: 56, xxxl: 80, page: 80, gutter: 24} as const;

const handheldMetrics = {
  hit: targets.touch,
  control: targets.touch,
  controlSmall: 34,
  icon: 22,
  iconSmall: 18,
  iconLarge: 28,
  railWidth: 60,
  railWidthExpanded: 212,
  posterWidth: 108,
  landscapeWidth: 176,
  squareWidth: 132,
  heroHeight: 380,
  focusRing: 0,
  focusScale: 1,
  pressScale: 0.97,
  radius: {small: designRadii.small, control: designRadii.control, card: designRadii.artwork, panel: designRadii.overlay, pill: designRadii.pill},
};
const televisionMetrics = {
  hit: targets.tenFoot,
  control: targets.tenFoot,
  /** APL-SYS-01: nothing focusable on TV is below the 64 px ten-foot minimum. */
  controlSmall: targets.tenFoot,
  icon: 30,
  iconSmall: 26,
  iconLarge: 38,
  railWidth: 112,
  railWidthExpanded: 340,
  posterWidth: 214,
  landscapeWidth: 356,
  squareWidth: 250,
  heroHeight: 620,
  focusRing: 4,
  focusScale: 1.08,
  pressScale: 1.02,
  radius: {small: Math.round(designRadii.small * tvRadiusMultiplier), control: Math.round(designRadii.control * tvRadiusMultiplier), card: Math.round(designRadii.artwork * tvRadiusMultiplier), panel: Math.round(designRadii.overlay * tvRadiusMultiplier), pill: designRadii.pill},
};

export type Theme = {
  isTV: boolean;
  /** Handheld pointer devices (iPad with trackpad) get hover states. */
  colors: Palette;
  type: Record<Role, TextStyle>;
  space: typeof handheldSpace | typeof televisionSpace;
  metrics: typeof handheldMetrics | typeof televisionMetrics;
  radii: typeof designRadii;
  motion: {quick: number; standard: number; slow: number; reduce: boolean};
  layers: typeof designLayers;
  window: {width: number; height: number; compact: boolean; wide: boolean};
  /** The viewer's "Show backdrops" setting: off means no artwork behind title pages and Home. */
  backdrops: boolean;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({children, reduceMotion = false, textScale = 1}: {children: React.ReactNode; /** The in-app preference; the system setting is always honoured as well (APL-SYS-03). */ reduceMotion?: boolean; /** TV only: the "Text size" device preference (1 or 1.2). */ textScale?: number}) {
  const {width, height} = useWindowDimensions();
  const systemReduceMotion = useSystemReduceMotion();
  const reduce = reduceMotion || systemReduceMotion;
  const value = useMemo<Theme>(
    () => ({
      isTV,
      colors: palette,
      type: isTV ? scaled(televisionType, textScale) : handheldType,
      space: isTV ? televisionSpace : handheldSpace,
      metrics: isTV ? televisionMetrics : handheldMetrics,
      radii: designRadii,
      motion: {quick: designMotion.quick, standard: designMotion.standard, slow: 320, reduce},
      layers: designLayers,
      window: {width, height, compact: !isTV && width < 500, wide: isTV || width >= 900},
      backdrops: true,
    }),
    [width, height, reduce, textScale],
  );
  return React.createElement(ThemeContext.Provider, {value}, children);
}

/**
 * The viewer's appearance settings, applied to everything inside: the card size (posters,
 * landscape tiles and square covers, on shelves and in grids alike) and whether artwork is drawn
 * behind title pages and Home. Mounted by the shell, inside the theme, once the profile's
 * settings are known; a card's caption, its focus ring and the text around it keep their size.
 */
export function AppearanceProvider({cardScale = 1, backdrops = true, children}: {cardScale?: number; backdrops?: boolean; children: React.ReactNode}) {
  const base = useTheme();
  const value = useMemo<Theme>(() => {
    if (cardScale === 1 && backdrops === base.backdrops) return base;
    const scaled = (width: number) => Math.round(width * cardScale);
    return {...base, backdrops, metrics: cardScale === 1 ? base.metrics : {...base.metrics, posterWidth: scaled(base.metrics.posterWidth), landscapeWidth: scaled(base.metrics.landscapeWidth), squareWidth: scaled(base.metrics.squareWidth)}};
  }, [base, cardScale, backdrops]);
  return React.createElement(ThemeContext.Provider, {value}, children);
}

/** The operating system's Reduce Motion setting, live. */
function useSystemReduceMotion(): boolean {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (active) setOn(v); }, () => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn);
    return () => { active = false; sub.remove(); };
  }, []);
  return on;
}

/**
 * The component spec (`packages/design/src/components.ts`, COMPONENTS.md) resolved for this
 * device: phone, tablet (iPad) or tv. Primitives read their measurements from here.
 */
export type SpecPlatform = 'phone' | 'tablet' | 'tv';
export const spec = componentSpec;
export function useSpecPlatform(): SpecPlatform {
  const {width, height} = useWindowDimensions();
  if (isTV) return 'tv';
  return Math.min(width, height) >= 600 ? 'tablet' : 'phone';
}
/** Vertical hit slop that grows a control of `height` to `min` on touch. */
export function hitSlopFor(height: number, min: number): {top: number; bottom: number} | undefined {
  if (isTV || height >= min) return undefined;
  const extra = Math.ceil((min - height) / 2);
  return {top: extra, bottom: extra};
}

export function useTheme(): Theme {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider.');
  return value;
}

/** Static access for style sheets that cannot use hooks. Prefer useTheme(). */
export const theme: Omit<Theme, 'window' | 'backdrops'> = {
  isTV,
  colors: palette,
  type: isTV ? televisionType : handheldType,
  space: isTV ? televisionSpace : handheldSpace,
  metrics: isTV ? televisionMetrics : handheldMetrics,
  radii: designRadii,
  motion: {quick: designMotion.quick, standard: designMotion.standard, slow: 320, reduce: false},
  layers: designLayers,
};

/** Translucent helper: `alpha('#rrggbb', 0.4)` → '#rrggbb66'. */
export function alpha(hex: string, opacity: number): string {
  const clamped = Math.max(0, Math.min(1, opacity));
  const value = Math.round(clamped * 255).toString(16).padStart(2, '0');
  return hex.length === 7 ? hex + value : hex.slice(0, 7) + value;
}

/**
 * A screen's one claim on focus. It is true for a moment once the thing that should hold focus
 * is ready (mounted, with its data), and never again: so a payload that arrives after a second
 * still gets its entry focus, and a later refresh never pulls focus off what the viewer is on.
 * A claim that only becomes ready long after the screen appeared is dropped, because by then
 * the viewer has moved somewhere on purpose.
 */
/**
 * Whether the viewer is moving through the rail: resting on a destination other than the one on
 * screen. A screen that finishes loading then must not take focus from them. Set by the rail.
 */
export const railBrowsing = {current: false};

export function useEntryFocus(ready = true, claimMs = 600, patienceMs = 6000): boolean {
  const [phase, setPhase] = React.useState<'waiting' | 'claiming' | 'done'>('waiting');
  const mounted = React.useRef(Date.now());
  React.useEffect(() => {
    if (!ready || phase !== 'waiting') return;
    if (Date.now() - mounted.current > patienceMs || railBrowsing.current) { setPhase('done'); return; }
    setPhase('claiming');
    const timer = setTimeout(() => setPhase('done'), claimMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return ready && phase !== 'done';
}
/** Entry focus for something that is ready the moment it mounts. */
export const useInitialFocus = (windowMs = 600): boolean => useEntryFocus(true, windowMs);
