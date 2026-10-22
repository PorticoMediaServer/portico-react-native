export type RowSlot<T> = Readonly<{id: string; focusId: string; sourceFocusId: string; item: T; waiting: boolean; position: number}>;
export type RowPage<T> = Readonly<{
  hasMore: boolean; loading: boolean; failed?: boolean;
  /** Stable source cursor identity; use the same renderItem/card host when this fills. */
  waitingId: string; waitingItem: T; requestNext: () => void;
}>;

/** A focused/retained row accepts appends and removals but defers server reordering. */
export function reconcileRowSlots<T>(previous: readonly RowSlot<T>[], items: readonly T[], getKey: (item: T) => string, owned: boolean, page?: RowPage<T>, getFocusId: (item: T) => string = getKey): readonly RowSlot<T>[] {
  const byId = new Map(items.map(item => [getKey(item), item]));
  if (byId.size !== items.length) throw new Error('Row item identities must be unique.');
  const oldById = new Map(previous.filter(slot => !slot.waiting).map(slot => [slot.sourceFocusId, slot]));
  const waiting = previous.find(slot => slot.waiting);
  const added = new Map<string, number>();
  for (const item of items) {const id = getKey(item); if (!oldById.has(getFocusId(item))) added.set(id, added.size);}
  const tail = waiting?.position ?? previous.reduce((max, slot) => Math.max(max, slot.position), -1) + 1;
  const byFocus = new Map<string, RowSlot<T>>();
  const slots = items.map((item, index) => {
    const id = getKey(item), sourceFocusId = getFocusId(item), old = oldById.get(sourceFocusId), newIndex = added.get(id);
    const fills = waiting && newIndex === 0;
    const slot = {id, focusId: old?.focusId ?? (fills ? waiting.focusId : sourceFocusId), sourceFocusId, item, waiting: false,
      position: owned ? old?.position ?? (fills ? waiting.position : tail + (newIndex ?? 0)) : index};
    byFocus.set(slot.focusId, slot);
    return slot;
  });
  if (new Set(slots.map(slot => slot.focusId)).size !== slots.length) throw new Error('Row focus identities must be unique.');
  let next = slots;
  if (owned) {
    const retained = previous.flatMap(slot => {const live = byFocus.get(slot.focusId); return live ? [live] : [];});
    const oldFocus = new Set(previous.map(slot => slot.focusId));
    next = [...retained, ...slots.filter(slot => !oldFocus.has(slot.focusId))];
  }
  if (page?.hasMore && !page.failed && items.length) {
    if (byFocus.has(page.waitingId)) throw new Error('Each waiting page must have a new stable cursor identity.');
    next.push({id: page.waitingId, focusId: page.waitingId, sourceFocusId: page.waitingId, item: page.waitingItem, waiting: true, position: next.reduce((max, slot) => Math.max(max, slot.position), -1) + 1});
  }
  return next;
}

/** Repeated focus events read these maps in O(visible); rebuilding is only for content/ownership changes. */
export function indexRowSlots<T>(slots: readonly RowSlot<T>[]) {
  return {slots, byFocus: new Map(slots.map(slot => [slot.focusId, slot])), byPosition: new Map(slots.map(slot => [slot.position, slot])),
    length: slots.reduce((max, slot) => Math.max(max, slot.position + 1), 0), order: slots.map(slot => slot.focusId)};
}
export function visibleRowSlots<T>(index: ReturnType<typeof indexRowSlots<T>>, first: number, last: number, focused?: string, remembered?: string): readonly RowSlot<T>[] {
  const visible = new Map<string, RowSlot<T>>();
  for (let position = Math.max(0, first - 2); position <= Math.min(index.length - 1, last + 2); position++) {
    const slot = index.byPosition.get(position); if (slot) visible.set(slot.focusId, slot);
  }
  for (const id of [focused, remembered]) {const slot = id ? index.byFocus.get(id) : undefined; if (slot) visible.set(slot.focusId, slot);}
  return [...visible.values()];
}
export function rowNeedsPage(last: number, count: number, page: {hasMore: boolean; loading: boolean; failed?: boolean} | undefined): boolean {
  return !!page?.hasMore && !page.loading && !page.failed && count > 0 && last >= Math.max(0, count - 10);
}
