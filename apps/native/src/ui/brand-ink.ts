/**
 * TV-RAIL-07: where the P is actually drawn in each brand asset, so the symbol and the wordmark's
 * own P can be put on the same pixels. Neither asset's box is its ink.
 *
 * - The symbol (`BrandMark`) draws in this viewBox, copied from `assets/brandSymbol`. It pads
 *   the outline, which spans x 228…487, y 206…567 of it: 259 × 361 of 304 × 405.
 * - `assets/wordmark.png` is 512 × 117. Its P, read from the alpha coverage of its edge pixels
 *   (a straight edge at 166/255 coverage sits 0.651 px into that pixel), starts 6.349 in from
 *   the left and 6.333 down from the top, and ends at 110.533 (bottom) and about 81.09 (right).
 *   That is the outline drawn in this viewBox's origin at the wordmark's height (6.356, 6.356,
 *   110.644, 81.178): the wordmark was drawn from the same source. So the symbol at the
 *   wordmark's height and origin lies on the wordmark's P, within 0.11 of a PNG pixel (0.05 at
 *   the television rail's 52).
 */
export const brandViewBox = {x: 206, y: 184, width: 304, height: 405} as const;
export const brandOutlineBounds = {x: 228, y: 206, width: 259, height: 361} as const;

export const wordmarkInk = {width: 512, height: 117, pLeft: 6.349, pTop: 6.333, pBottom: 110.533, pRight: 81.09} as const;
