import React, {createContext, forwardRef, useCallback, useContext, useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {findNodeHandle, TVFocusGuideView, View, type FocusGuideMethods, type ViewProps} from 'react-native';
import {useTheme} from '../theme';
import {createFocusRegistry, focusTestID, type FocusAddress, type FocusHost, type FocusRegionConfig, type FocusRegistry} from './registry';
import {useHostRef} from './useHostRef';

const RegistryContext = createContext<FocusRegistry | null>(null);
const RegionContext = createContext<string | undefined>(undefined);
const ItemContext = createContext<Readonly<{focusId: string; testID?: string; waiting?: boolean}> | undefined>(undefined);
export function FocusProvider({registry, children}: {registry?: FocusRegistry; children: React.ReactNode}) {
  const parent = useContext(RegistryContext), own = useRef<FocusRegistry | undefined>(undefined);
  if (!own.current) own.current = createFocusRegistry();
  return <RegistryContext.Provider value={registry ?? parent ?? own.current}>{children}</RegistryContext.Provider>;
}
export function useOptionalFocusRegistry() {return useContext(RegistryContext);}
export function useFocusRegistry(): FocusRegistry {
  const registry = useOptionalFocusRegistry();
  if (!registry) throw new Error('A FocusProvider must contain regions that share focus.');
  return registry;
}
export function FocusItem({focusId, testID, waiting, children}: {focusId: string; testID?: string; waiting?: boolean; children: React.ReactNode}) {
  return <ItemContext.Provider value={{focusId, testID, waiting}}>{children}</ItemContext.Provider>;
}
export function useFocusWaiting(): boolean {return useContext(ItemContext)?.waiting ?? false;}
export type FocusRegionProps = Omit<ViewProps, 'id' | 'onFocus' | 'onBlur'> & FocusRegionConfig & {onFocusChange?: (ownsFocus: boolean) => void};
type Guide = View & FocusGuideMethods;

export const FocusRegion = forwardRef<View, FocusRegionProps>(function FocusRegion({children, onFocusChange, ...props}, ref) {
  const parent = useOptionalFocusRegistry();
  return parent ? <Region {...props} onFocusChange={onFocusChange} ref={ref}>{children}</Region>
    : <FocusProvider><Region {...props} onFocusChange={onFocusChange} ref={ref}>{children}</Region></FocusProvider>;
});
const Region = forwardRef<View, FocusRegionProps>(function Region({id, entry, entryPolicy = 'memory', order, neighbors, screenStart, edges, orientation = 'free', hold = false, enabled = true, onFocusChange, children, testID, ...view}, ref) {
  const registry = useFocusRegistry(), {isTV} = useTheme(), owner = useRef({});
  const onHost = useCallback((host: Guide | null) => {registry.attachRegion(id, host, owner.current);}, [id, registry]);
  const {native, ref: setRef} = useHostRef<View, Guide>(ref, onHost);
  const revision = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  const config = {id, entry, entryPolicy, order, neighbors, screenStart, edges, orientation, hold, enabled};
  useLayoutEffect(() => {registry.configure(config);});
  useLayoutEffect(() => {
    const registrationOwner = owner.current;
    const release = registry.mountRegion(id, registrationOwner);
    registry.attachRegion(id, native.current, registrationOwner);
    return () => {registry.attachRegion(id, null, registrationOwner); release();};
  }, [id, native, registry]);
  if (isTV && !id.trim()) throw new Error('A TV focus region requires a stable caller identity.');
  const ownsFocus = registry.isRegionActive(id);
  useLayoutEffect(() => {onFocusChange?.(ownsFocus);}, [ownsFocus, onFocusChange]);
  useLayoutEffect(() => {
    if (!isTV) return;
    const childId = entryPolicy === 'entry' ? entry : registry.remembered(id) ?? entry;
    const target = childId ? registry.child({regionId: id, childId}) : undefined;
    // Imperative destination API accepts real host handles (installed RN TV types).
    const handle = target ? findNodeHandle(target as View) : null;
    native.current?.setDestinations(handle == null ? [] : [handle]);
  }, [entry, entryPolicy, id, isTV, native, registry, revision]);
  const body = <RegionContext.Provider value={id}>{children}</RegionContext.Provider>;
  return isTV ? <TVFocusGuideView {...view} testID={testID ?? `portico.region.${encodeURIComponent(id)}`} ref={setRef} autoFocus
    focusable={enabled} trapFocusUp={hold} trapFocusDown={hold} trapFocusLeft={hold} trapFocusRight={hold || orientation === 'horizontal'}>{body}</TVFocusGuideView>
    : <View {...view} testID={testID} ref={setRef}>{body}</View>;
});

export type FocusTargetOptions<T extends FocusHost = View> = {focusId?: string; testID?: string; disabled?: boolean; ref?: React.ForwardedRef<T>};
/** Bind the actual native host. No remote-key listener or per-key app decision. */
export function useFocusTarget<T extends FocusHost = View>({focusId, testID, disabled, ref}: FocusTargetOptions<T>) {
  const registry = useOptionalFocusRegistry(), regionId = useContext(RegionContext), item = useContext(ItemContext);
  const childId = focusId ?? item?.focusId ?? testID;
  const stableTestID = testID ?? item?.testID ?? (regionId && childId ? focusTestID(regionId, childId) : undefined);
  if (regionId && !childId && !disabled) throw new Error('A region child requires a stable focusId or testID from its caller.');
  const owner = useRef({});
  const committed = useRef({registry, regionId, childId, disabled});
  const onHost = useCallback((host: T | null) => {
    const c = committed.current;
    if (c.registry && c.regionId && c.childId) c.registry.attach({regionId: c.regionId, childId: c.childId}, c.disabled ? null : host, owner.current);
  }, []);
  const {native, ref: setRef} = useHostRef<T>(ref ?? null, onHost);
  const emptySubscribe = useCallback(() => () => {}, []), zero = useCallback(() => 0, []);
  useSyncExternalStore(registry?.subscribe ?? emptySubscribe, registry?.getSnapshot ?? zero, registry?.getSnapshot ?? zero);
  useLayoutEffect(() => {
    committed.current = {registry, regionId, childId, disabled};
    if (!registry || !regionId || !childId) return;
    const address = {regionId, childId};
    registry.attach(address, disabled ? null : native.current, owner.current);
    const registrationOwner = owner.current;
    return () => {registry.attach(address, null, registrationOwner);};
  }, [childId, disabled, native, regionId, registry]);
  const config = regionId ? registry?.config(regionId) : undefined;
  const edgeProps: Pick<ViewProps, 'nextFocusUp' | 'nextFocusDown' | 'nextFocusLeft' | 'nextFocusRight'> = {};
  const order = regionId ? registry?.order(regionId) : undefined;
  if (registry && config?.edges && childId) {
    for (const direction of ['up', 'down', 'left', 'right'] as const) {
      const target = config.edges[direction];
      if (!target || config.hold) continue;
      if (config.orientation === 'horizontal' && (direction === 'left' && order?.[0] !== childId || direction === 'right' && order?.at(-1) !== childId)) continue;
      if (config.orientation === 'vertical' && (direction === 'up' && order?.[0] !== childId || direction === 'down' && order?.at(-1) !== childId)) continue;
      const host = registry.host(target);
      const handle = host ? findNodeHandle(host as View) : null;
      if (handle != null) {
        const key = {up: 'nextFocusUp', down: 'nextFocusDown', left: 'nextFocusLeft', right: 'nextFocusRight'} as const;
        edgeProps[key[direction]] = handle;
      }
    }
  }
  const address: FocusAddress | undefined = regionId && childId ? {regionId, childId} : undefined;
  return {ref: setRef, testID: stableTestID, waiting: item?.waiting ?? false, ...edgeProps,
    onFocus: () => {if (registry && address && !disabled) registry.didFocus(address);},
    onBlur: () => {if (registry && address) registry.didBlur(address);},
  };
}
