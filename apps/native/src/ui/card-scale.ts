/**
 * The card size the viewer chose in Settings (`appearance.cardSizePercent`), as the web applies
 * it: three sizes, never a free percentage, so a row of cards always lands on a designed width.
 * Below 90 % is Small, above 115 % is Large, anything else is the standard size.
 */
export function cardScaleFor(percent: unknown): number {
  const value = typeof percent === 'number' && Number.isFinite(percent) ? percent : 100;
  return value < 90 ? 0.82 : value > 115 ? 1.25 : 1;
}
