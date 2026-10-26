/** Only mounted/pinned slots are projected. No data, callbacks or O(total) state. */
export type OfferedNativeSlot = Readonly<{index: number; entityId?: string; waiting: boolean}>;
export type NativeWindowedSlot = OfferedNativeSlot & Readonly<{focusId: string; key: string; source: string; formerEntityId?: string}>;
export type NativeSlotProjection = Readonly<{owner: object; generation: number; ownerKey: number; slots: readonly NativeWindowedSlot[]}>;

const owners = new WeakMap<object, number>();
let nextOwner = 0;
/** Opaque UI identity only; weak keys never retain a retired collection/authority. */
export function nativeSlotOwnerKey(owner: object): number {
  let key = owners.get(owner);
  if (key === undefined) {key = ++nextOwner; owners.set(owner, key);}
  return key;
}

/** Pure render projection; the caller publishes this only after React commits. */
export function projectNativeSlots(previous: NativeSlotProjection | undefined, owner: object, ownerKey: number, generation: number,
  incoming: readonly OfferedNativeSlot[]): NativeSlotProjection {
  const sameOwner = previous?.owner === owner && previous.ownerKey === ownerKey ? previous : undefined;
  const sameSource = sameOwner?.generation === generation ? sameOwner : undefined;
  const entities = new Map((sameOwner?.slots ?? []).filter(slot => slot.entityId !== undefined || slot.formerEntityId !== undefined).map(slot => [slot.entityId ?? slot.formerEntityId!, slot] as const));
  const positions = new Map((sameSource?.slots ?? []).map(slot => [slot.index, slot] as const));
  const source = JSON.stringify([ownerKey, generation]);
  const slots = incoming.map(slot => {
    const at = positions.get(slot.index);
    const entity = slot.entityId === undefined ? undefined : entities.get(slot.entityId);
    // Only an actual same-source arrival fills its waiting host. A new owner or
    // generation never claims that an unrelated item fulfilled the old request.
    const formerEntityId = at?.entityId ?? at?.formerEntityId;
    const sameArrival = at?.waiting && (formerEntityId === undefined || formerEntityId === slot.entityId);
    const inherited = entity ?? (slot.waiting || sameArrival ? at : undefined);
    const focusId = inherited?.focusId ?? JSON.stringify(slot.entityId === undefined
      ? [ownerKey, 'pending', generation, slot.index] : [ownerKey, 'entry', slot.entityId]);
    return {index: slot.index, entityId: slot.entityId, waiting: slot.waiting, focusId, key: JSON.stringify([ownerKey, focusId]), source, ...(slot.waiting && formerEntityId !== undefined ? {formerEntityId} : {})};
  });
  return {owner, ownerKey, generation, slots};
}
