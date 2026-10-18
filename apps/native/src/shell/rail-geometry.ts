/**
 * TV-RAIL-02/05/07: the rail's geometry as plain numbers. `Rail.tsx` feeds them to its animated
 * styles (which repeat the one-line formulas below inside their worklets) and the tests pin them.
 *
 * The panel is always `railWidthExpanded` wide and slides left by `hiddenWidth × (1 − p)`
 * (p: 0 collapsed → 1 expanded). Every row's Focusable stays the panel's full inner width, so its
 * native focus frame is the same in every state and never changes mid-animation. What the viewer
 * sees (the row's surface, icon and label, the header and the dividers) sits in a foreground that
 * is counter-translated by exactly the panel's slide, so on screen it does not move at all; only
 * the surface's right edge travels, with the panel's. "Local" x below is measured from the left
 * of such a foreground, which is the panel's left padding on screen in every state.
 */
import {brandOutlineBounds, brandViewBox, wordmarkInk} from '../ui/brand-ink';

export type RailFrame = {
  railWidth: number;
  railWidthExpanded: number;
  /** The panel's horizontal padding. */
  paddingX: number;
  /** The panel's right border. */
  border: number;
  /** The row icon's size. */
  icon: number;
  /** Icon to label. */
  gap: number;
  /** Dividers are inset this much from each end of the row surface. */
  dividerInset: number;
};

export function railGeometry(frame: RailFrame) {
  const {railWidth, railWidthExpanded, paddingX, border, icon, gap, dividerInset} = frame;
  const hiddenWidth = railWidthExpanded - railWidth;
  /** The visible column inside the padding and the border: the collapsed surface. */
  const collapsedInner = railWidth - 2 * paddingX - border;
  /** Every row's (and the header's) full width in the panel. */
  const expandedInner = railWidthExpanded - 2 * paddingX - border;
  /** The icon is centred in the collapsed surface, and stays there. */
  const iconX = (collapsedInner - icon) / 2;
  return {
    hiddenWidth,
    collapsedInner,
    expandedInner,
    paddingX,
    iconX,
    textX: iconX + icon + gap,
    dividerInset,
    dividerWidth: expandedInner - 2 * dividerInset,
  };
}

export type RailGeometry = ReturnType<typeof railGeometry>;

/** The panel's translateX. */
export const panelX = (g: RailGeometry, p: number) => -g.hiddenWidth * (1 - p);

/** The surface (fill, selected bar, focus ring) is as wide as the visible part of the row. */
export const surfaceWidth = (g: RailGeometry, p: number) => g.collapsedInner + g.hiddenWidth * p;

/**
 * The foreground's translateX: undo the panel's slide, and when the row scales on focus (TV row
 * focus scale), scale about the visible surface's centre rather than the full-width host's.
 * Used as `transform: [{translateX: this}, {scale}]`, the scale being about the foreground's own centre.
 */
export const foregroundX = (g: RailGeometry, p: number, scale = 1) =>
  g.hiddenWidth * (1 - p) + (surfaceWidth(g, p) / 2 - g.expandedInner / 2) * (1 - scale);

/**
 * A divider is a full-width line (no layout animation) scaled to the surface's width less its
 * insets, about its left end, and counter-translated like the rows.
 */
export const dividerTransform = (g: RailGeometry, p: number) => {
  const scaleX = (surfaceWidth(g, p) - 2 * g.dividerInset) / g.dividerWidth;
  return {translateX: g.hiddenWidth * (1 - p) - (g.dividerWidth / 2) * (1 - scaleX), scaleX};
};

/** Where a local x (unscaled) lands on screen. */
export const screenX = (g: RailGeometry, p: number, local: number) => panelX(g, p) + g.paddingX + g.hiddenWidth * (1 - p) + local;

/**
 * TV-RAIL-07: the brand. Expanded it is the wordmark alone; collapsed, the symbol alone, its
 * visible P centred in the collapsed column like the row icons. The symbol is drawn at the
 * wordmark's height and at the wordmark's origin, which puts it on the wordmark's own P
 * (brand-ink.ts), so opening the rail only adds the letters after it. One origin for both also
 * means the platform rounds both boxes to the same pixels.
 * Coordinates are local to the header slot (`slotHeight` tall), which is counter-translated too.
 */
export function railBrandGeometry({brandHeight, slotHeight, collapsedInner}: {brandHeight: number; slotHeight: number; collapsedInner: number}) {
  const unit = brandHeight / brandViewBox.height;
  const inkX = (brandOutlineBounds.x - brandViewBox.x) * unit;
  const pWidth = brandOutlineBounds.width * unit;
  const x = (collapsedInner - pWidth) / 2 - inkX;
  const y = (slotHeight - brandHeight) / 2;
  const word = brandHeight / wordmarkInk.height;
  return {
    /** `BrandMark size={size}` and `Wordmark height={size}`, both at x, y. */
    x,
    y,
    size: brandHeight,
    wordmarkWidth: wordmarkInk.width * word,
    /** The symbol's visible P. */
    p: {x: x + inkX, y: y + (brandOutlineBounds.y - brandViewBox.y) * unit, width: pWidth, height: brandOutlineBounds.height * unit},
    /** The wordmark's visible P, as measured in its PNG. */
    wordmarkP: {x: x + wordmarkInk.pLeft * word, y: y + wordmarkInk.pTop * word, width: (wordmarkInk.pRight - wordmarkInk.pLeft) * word, height: (wordmarkInk.pBottom - wordmarkInk.pTop) * word},
  };
}

/**
 * TV-RAIL-05: a row with a subtitle (Settings, with the server's name) is at least the spec's
 * subtitle row, and never shorter than its two lines and the row padding, at any text size.
 * The same whether the rail is open or not, so the scroller above it never changes height.
 */
export const railRowHeight = ({single, withSubtitle, titleLine, subtitleLine, paddingY}: {single: number; withSubtitle?: number; titleLine: number; subtitleLine: number; paddingY: number}) =>
  withSubtitle === undefined ? single : Math.max(single, withSubtitle, titleLine + subtitleLine + 2 * paddingY);
