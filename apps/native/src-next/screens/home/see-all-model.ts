/** Frame collections#46/#44: Unwatched, In progress and Favorites are the drawn quick
 * toggles on See all. My List stays inside Filters, as the same frame draws it. */
export const homeSeeAllQuickIds = ['unwatched', 'in-progress', 'favorites'] as const;

export const homeSeeAllQuickOrder = (id: string): boolean => (homeSeeAllQuickIds as readonly string[]).includes(id);
