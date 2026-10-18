import type {TextStyle} from 'react-native';

/** Manrope's ascent plus descent in em (hhea 2132 + 600 over 2000 units). */
const MANROPE_EXTENT = 2732 / 2000;

/**
 * Android lays out a line height shorter than the font the CSS way: the missing leading comes off
 * the top and bottom of the font's extent, and the text view ends there, so a tight display role
 * loses its descenders (the g of "Sign in"). That room is given back as padding and taken out again
 * as negative margin, so glyphs draw whole and the layout is unchanged. Apple and web draw
 * overflowing glyphs and keep the designed line height as it is.
 */
export function lineRoom(style: TextStyle, scale: number): number {
  const {fontSize, lineHeight} = style;
  if (typeof fontSize !== 'number' || typeof lineHeight !== 'number') return 0;
  const over = (fontSize * MANROPE_EXTENT - lineHeight) * scale;
  return over >= 2 ? Math.ceil(over / 2) : 0;
}

/** The style with `room` added inside and taken away outside, top and bottom; unchanged when the caller's spacing isn't numeric. */
export function withLineRoom(style: TextStyle, room: number): TextStyle {
  const side = (...keys: (keyof TextStyle)[]): unknown => keys.map(k => style[k]).find(v => v !== undefined) ?? 0;
  const pt = side('paddingTop', 'paddingVertical', 'padding');
  const pb = side('paddingBottom', 'paddingVertical', 'padding');
  const mt = side('marginTop', 'marginVertical', 'margin');
  const mb = side('marginBottom', 'marginVertical', 'margin');
  if (typeof pt !== 'number' || typeof pb !== 'number' || typeof mt !== 'number' || typeof mb !== 'number') return style;
  return {...style, paddingTop: pt + room, paddingBottom: pb + room, marginTop: mt - room, marginBottom: mb - room};
}
