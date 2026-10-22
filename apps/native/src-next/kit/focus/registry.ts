/** Explicit lifecycle restoration only. Native guides perform directional traversal. */
export type FocusAddress = Readonly<{regionId: string; childId: string}>;
export type FocusHost = {requestTVFocus?: () => void; focus?: () => void};
export type FocusEdges = Readonly<Partial<Record<'up' | 'down' | 'left' | 'right', string>>>;
export type FocusRegionConfig = Readonly<{
  id: string; entry?: string; entryPolicy?: 'memory' | 'entry'; order?: readonly string[];
  neighbors?: Readonly<{next?: string; previous?: string}>; screenStart?: FocusAddress;
  edges?: FocusEdges; orientation?: 'horizontal' | 'vertical' | 'free'; hold?: boolean; enabled?: boolean;
}>;
export type FocusSnapshot = FocusAddress & Readonly<{
  order: readonly string[]; neighbors?: FocusRegionConfig['neighbors']; screenStart?: FocusAddress; returnTo?: FocusSnapshot;
}>;
const idPart = (value: string) => encodeURIComponent(value).replaceAll('.', '%2E');
export const focusTestID = (regionId: string, childId: string): string => `portico.focus.${idPart(regionId)}.${idPart(childId)}`;
const same = (a: FocusAddress | undefined, b: FocusAddress | undefined) => !!a && !!b && a.regionId === b.regionId && a.childId === b.childId;
const request = (host: FocusHost | undefined): boolean => {
  if (host?.requestTVFocus) {host.requestTVFocus(); return true;}
  if (host?.focus) {host.focus(); return true;}
  return false;
};
const configKey = (c: FocusRegionConfig) => JSON.stringify([c.entry, c.entryPolicy, c.order, c.neighbors?.next, c.neighbors?.previous,
  c.screenStart?.regionId, c.screenStart?.childId, c.edges?.up, c.edges?.down, c.edges?.left, c.edges?.right, c.orientation, c.hold, c.enabled]);

export function createFocusRegistry() {
  type Child = {host: FocusHost; owner?: object};
  type Region = {config: FocusRegionConfig; host?: FocusHost; hostOwner?: object; owner?: object; children: Map<string, Child>; remembered?: string; returns: Map<object, FocusSnapshot | undefined>};
  const regions = new Map<string, Region>(), listeners = new Set<() => void>();
  const retained = new Map<object, FocusSnapshot[]>(), memory = new Map<string, string>();
  let active: FocusSnapshot | undefined, revision = 0, epoch = 0, recoveredEpoch = -1;
  const emit = () => {revision++; for (const listener of listeners) listener();};
  const isRetained = (id: string) => [...retained.values()].some(chain => chain.some(saved => saved.regionId === id));
  const prune = (id: string) => {
    const r = regions.get(id);
    if (!r || r.owner || r.host || r.children.size || r.returns.size || active?.regionId === id || isRetained(id)) return;
    if (r.remembered) {
      memory.delete(id); memory.set(id, r.remembered);
      if (memory.size > 64) memory.delete(memory.keys().next().value!);
    }
    regions.delete(id);
  };
  const region = (id: string): Region => {
    let value = regions.get(id);
    if (!value) {value = {config: {id}, children: new Map(), returns: new Map(), remembered: memory.get(id)}; memory.delete(id); regions.set(id, value);}
    return value;
  };
  const order = (r: Region) => r.config.order ?? [...r.children.keys()];
  const snapshot = (address: FocusAddress): FocusSnapshot => {
    const r = region(address.regionId);
    return {...address, order: [...order(r)], neighbors: r.config.neighbors, screenStart: r.config.screenStart, returnTo: [...r.returns.values()].at(-1)};
  };
  const currentSnapshot = (saved: FocusSnapshot) => {
    const r = regions.get(saved.regionId);
    // Once removed, keep its last committed relative order. Saved overlay openers are immutable.
    return r && order(r).includes(saved.childId) ? snapshot(saved) : saved;
  };
  const focus = (address: FocusAddress): boolean => {
    const r = regions.get(address.regionId);
    return r?.config.enabled !== false && request(r?.children.get(address.childId)?.host);
  };
  const focusRegion = (id: string): boolean => {
    const r = regions.get(id);
    if (!r || r.config.enabled === false || !r.children.size) return false;
    const first = r.config.entryPolicy === 'entry' ? r.config.entry : r.remembered ?? r.config.entry;
    if (first && focus({regionId: id, childId: first})) return true;
    if (r.config.entry && focus({regionId: id, childId: r.config.entry})) return true;
    for (const childId of order(r)) if (focus({regionId: id, childId})) return true;
    return request(r.host);
  };
  const restore = (saved: FocusSnapshot | undefined, visited = new Set<string>()): boolean => {
    if (!saved || visited.has(saved.regionId)) return false;
    visited.add(saved.regionId);
    if (focus(saved)) return true;
    const at = saved.order.indexOf(saved.childId);
    for (const childId of [...saved.order.slice(at + 1), ...saved.order.slice(0, Math.max(0, at)).reverse()]) {
      if (focus({regionId: saved.regionId, childId})) return true;
    }
    const r = regions.get(saved.regionId);
    if (r?.children.size && focusRegion(saved.regionId)) return true;
    const neighbors = r?.config.neighbors ?? saved.neighbors;
    if (neighbors?.next && focusRegion(neighbors.next)) return true;
    if (neighbors?.previous && focusRegion(neighbors.previous)) return true;
    if (saved.returnTo && restore(saved.returnTo, visited)) return true;
    const start = r?.config.screenStart ?? saved.screenStart;
    return !!start && focus(start);
  };
  const recover = (saved: FocusSnapshot) => {
    const captured = epoch;
    queueMicrotask(() => {
      if (epoch !== captured || recoveredEpoch === captured || !same(active, saved)) return;
      if (!regions.get(saved.regionId)?.children.has(saved.childId)) {recoveredEpoch = captured; restore(saved);}
    });
  };
  const schedulePrune = (id: string) => queueMicrotask(() => {
    const r = regions.get(id);
    if (r && !r.owner && !r.host && !r.children.size && active?.regionId === id && !isRetained(id)) {active = undefined; emit();}
    prune(id);
  });
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => revision,
    capture: (): FocusSnapshot | undefined => active && {...currentSnapshot(active), order: [...currentSnapshot(active).order]},
    focus, focusRegion, restore,
    order: (id: string): readonly string[] => {const r = regions.get(id); return r ? order(r) : [];},
    remembered: (id: string) => regions.get(id)?.remembered ?? memory.get(id),
    config: (id: string) => regions.get(id)?.config,
    host: (id: string): FocusHost | undefined => regions.get(id)?.host,
    child: (address: FocusAddress): FocusHost | undefined => regions.get(address.regionId)?.children.get(address.childId)?.host,
    recovery: (id: string): readonly FocusSnapshot[] => [active, ...[...retained.values()].flat()].filter((saved): saved is FocusSnapshot => saved?.regionId === id),
    isRegionActive: (id: string): boolean => active?.regionId === id || isRetained(id),
    retain(address: FocusAddress | FocusSnapshot) {
      const chain: FocusSnapshot[] = [], visited = new Set<string>();
      let saved: FocusSnapshot | undefined = 'order' in address ? address : snapshot(address);
      while (saved && !visited.has(saved.regionId)) {visited.add(saved.regionId); chain.push(saved); saved = saved.returnTo;}
      const owner = {}; retained.set(owner, chain); emit();
      return () => {if (!retained.delete(owner)) return; emit(); for (const saved of chain) schedulePrune(saved.regionId);};
    },
    registerReturn(id: string, opener: FocusSnapshot | undefined) {
      const r = region(id), owner = {}; r.returns.set(owner, opener);
      return () => {r.returns.delete(owner); schedulePrune(id);};
    },
    mountRegion(id: string, owner: object) {
      const r = region(id);
      if (r.owner && r.owner !== owner) throw new Error(`Duplicate live focus region: ${id}`);
      r.owner = owner;
      return () => {if (r.owner === owner) r.owner = undefined; schedulePrune(id);};
    },
    configure(config: FocusRegionConfig) {
      const r = region(config.id);
      if (configKey(r.config) === configKey(config)) return;
      r.config = {...config, order: config.order && [...config.order], edges: config.edges && {...config.edges}, neighbors: config.neighbors && {...config.neighbors}, screenStart: config.screenStart && {...config.screenStart}};
      if (active?.regionId === config.id) active = currentSnapshot(active);
      emit();
    },
    attachRegion(id: string, host: FocusHost | null, owner?: object) {
      const r = host ? region(id) : regions.get(id);
      if (!r) return;
      if (host && r.host && (r.host !== host || r.hostOwner !== owner)) throw new Error(`Duplicate live focus region host: ${id}`);
      if (!host && owner && r.hostOwner !== owner) return;
      if (r.host === (host ?? undefined)) return;
      r.host = host ?? undefined; r.hostOwner = host ? owner : undefined; emit();
      if (!host && active?.regionId === id) recover(active);
      if (!host) schedulePrune(id);
    },
    attach(address: FocusAddress, host: FocusHost | null, owner?: object) {
      const r = host ? region(address.regionId) : regions.get(address.regionId);
      if (!r) return;
      const old = r.children.get(address.childId);
      if (host && old && (old.host !== host || old.owner !== owner)) throw new Error(`Duplicate live focus child: ${address.regionId}/${address.childId}`);
      if (!host && owner && old?.owner !== owner) return;
      if (old?.host === (host ?? undefined)) return;
      if (host) r.children.set(address.childId, {host, owner}); else r.children.delete(address.childId);
      emit();
      if (!host && same(active, address) && active) recover(active);
      if (!host) schedulePrune(address.regionId);
    },
    didFocus(address: FocusAddress) {
      const previous = active?.regionId;
      epoch++; const r = region(address.regionId); r.remembered = address.childId;
      active = snapshot(address); emit(); if (previous) schedulePrune(previous);
    },
    didBlur(address: FocusAddress) {
      const captured = epoch;
      queueMicrotask(() => {if (captured === epoch && same(active, address)) {
        // A detached focused host must recover before blur releases its ownership.
        if (!regions.get(address.regionId)?.children.has(address.childId)) {if (active) recover(active); return;}
        active = undefined; epoch++; emit(); schedulePrune(address.regionId);
      }});
    },
    size: () => ({regions: regions.size, remembered: memory.size}),
  };
}
export type FocusRegistry = ReturnType<typeof createFocusRegistry>;
