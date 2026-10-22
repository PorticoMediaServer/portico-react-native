/**
 * How subtitles the device draws look: Portico's own caption style, which every engine applies
 * on top of the system's (ENGINE-CONTRACT.md, section 7).
 *
 * The profile's two settings are the same ones the web player draws by: a size (small, medium,
 * large, extra large) and a background (none, a soft box, a solid box). The engine multiplies
 * the size by the size the viewer set for captions in the device's own Accessibility settings,
 * and where the viewer set caption colours there, the system's win.
 */
export type CaptionBackground = 'none' | 'translucent' | 'opaque';
export type CaptionStyle = Readonly<{scale: number; background: CaptionBackground}>;

const scales: Readonly<Record<string, number>> = {small: 0.8, medium: 1, large: 1.3, 'extra-large': 1.6};

export const defaultCaptionStyle: CaptionStyle = Object.freeze({scale: 1, background: 'translucent'});

/** The caption style for the profile's `playback.subtitleSize` and `playback.subtitleBackground`. */
export function captionStyle(size: unknown, background: unknown): CaptionStyle {
  const scale = typeof size === 'string' ? scales[size] : undefined;
  const box: CaptionBackground = background === 'none' || background === 'opaque' ? background : 'translucent';
  if ((scale ?? 1) === 1 && box === 'translucent') return defaultCaptionStyle;
  return Object.freeze({scale: scale ?? 1, background: box});
}
