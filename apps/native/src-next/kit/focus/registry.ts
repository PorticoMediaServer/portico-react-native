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

export function createFocusRegistry() {
  type Region = {config: FocusRegionConfig; host?: FocusHost; children: Map<string, FocusHost>; remembered?: string; returnTo?: FocusSnapshot};
  const regions = new Map<string, Region>(), listeners = new Set<() => void>(), retained = new Map<string, number>();
  let active: FocusSnapshot | undefined, revision = 0, epoch = 0;
  const emit = () => {revision++; for (const listener of listeners) listener();};
  const region = (id: string): Region => {
    let value = regions.get(id);
    if (!value) {value = {config: {id}, children: new Map()}; regions.set(id, value);}
    return value;
  };
  const order = (r: Region) => r.config.order ?? [...r.children.keys()];
  const snapshot = (address: FocusAddress): FocusSnapshot => {
    const r = region(address.regionId);
    return {...address, order: [...order(r)], neighbors: r.config.neighbors, screenStart: r.config.screenStart, returnTo: r.returnTo};
  };
  const focus = (address: FocusAddress): boolean => {
    const r = regions.get(address.regionId);
    return r?.config.enabled !== false && request(r?.children.get(address.childId));
  };
  const focusRegion = (id: string): boolean => {
    const r = regions.get(id);
    if (!r || r.config.enabled === false || !r.children.size) return false;
    const first = r.config.entryPolicy === 'entry' ? r.config.entry : r.remembered ?? r.config.entry;
    if (first && focus({regionId: id, childId: first})) return true;
    for (const childId of order(r)) if (focus({regionId: id, childId})) return true;
    return request(r.host);
  };
  const restore = (saved: FocusSnapshot | undefined, visited = new Set<string>()): boolean => {
    if (!saved || visited.has(saved.regionId)) return false;
    visited.add(saved.regionId);
    if (focus(saved)) return true;
    const at = saved.order.indexOf(saved.childId);
    // A removal takes the next surviving neighbour, then the previous one at the end.
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
    // Let the whole React commit attach replacements before considering a fallback.
    queueMicrotask(() => {
      if (epoch !== captured || !same(active, saved)) return;
      if (!regions.get(saved.regionId)?.children.has(saved.childId)) restore(saved);
    });
  };
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => revision,
    capture: (): FocusSnapshot | undefined => active && {...active, order: [...active.order]},
    focus, focusRegion, restore,
    order: (id: string): readonly string[] => {const r = regions.get(id); return r ? order(r) : [];},
    remembered: (id: string) => regions.get(id)?.remembered,
    config: (id: string) => regions.get(id)?.config,
    host: (id: string): FocusHost | undefined => regions.get(id)?.host,
    child: (address: FocusAddress): FocusHost | undefined => regions.get(address.regionId)?.children.get(address.childId),
    isRegionActive: (id: string): boolean => active?.regionId === id || (retained.get(id) ?? 0) > 0,
    retain(address: FocusAddress) {
      retained.set(address.regionId, (retained.get(address.regionId) ?? 0) + 1); emit();
      let live = true;
      return () => {if (!live) return; live = false; const count = (retained.get(address.regionId) ?? 1) - 1; if (count) retained.set(address.regionId, count); else retained.delete(address.regionId); emit();};
    },
    registerReturn(id: string, opener: FocusSnapshot | undefined) {
      const r = region(id), previous = r.returnTo;
      r.returnTo = opener;
      return () => {if (r.returnTo === opener) r.returnTo = previous;};
    },
    configure(config: FocusRegionConfig) {region(config.id).config = config;},
    attachRegion(id: string, host: FocusHost | null) {
      const r = region(id);
      if (r.host === (host ?? undefined)) return;
      r.host = host ?? undefined; emit();
      if (!host && active?.regionId === id) recover(active);
    },
    attach(address: FocusAddress, host: FocusHost | null) {
      const r = region(address.regionId);
      if (r.children.get(address.childId) === (host ?? undefined)) return;
      if (host) r.children.set(address.childId, host); else r.children.delete(address.childId);
      emit();
      if (!host && same(active, address) && active) recover(active);
    },
    didFocus(address: FocusAddress) {
      epoch++; const r = region(address.regionId); r.remembered = address.childId;
      active = snapshot(address); emit();
    },
    didBlur(address: FocusAddress) {
      const captured = epoch;
      queueMicrotask(() => {if (captured === epoch && same(active, address)) {active = undefined; epoch++; emit();}});
    },
  };
}
export type FocusRegistry = ReturnType<typeof createFocusRegistry>;
