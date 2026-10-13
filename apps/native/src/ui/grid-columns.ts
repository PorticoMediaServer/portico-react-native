/** How many cards of `itemWidth` fit across `available`, and how wide each then is. */
export function gridColumns(available: number, itemWidth: number, spacing: number): {columns: number; columnWidth: number} {
  const columns = Math.max(1, Math.floor((available + spacing) / (itemWidth + spacing)));
  return {columns, columnWidth: Math.max(1, Math.floor((available - spacing * (columns - 1)) / columns))};
}
