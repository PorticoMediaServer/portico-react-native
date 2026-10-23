import {useLayoutEffect, useMemo, useSyncExternalStore} from 'react';
import {useFocusRegistry} from '../../kit/focus';
import type {FocusAddress} from '../../kit/focus/registry';
import {createDestinationEntryFocus, type NativeDestinationActivation} from './focus';

export function useDestinationEntryFocus(activation: NativeDestinationActivation, address: FocusAddress | undefined, beforeFocus?: () => void) {
  const registry = useFocusRegistry();
  const revision = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  const request = useMemo(() => createDestinationEntryFocus(registry), [registry]);
  const regionId = address?.regionId, childId = address?.childId;
  useLayoutEffect(() => {
    if (!activation.visible || activation.intent === 'restore' || !regionId || !childId || !registry.child({regionId, childId})) {
      request(activation, undefined); return;
    }
    if (request(activation, {regionId, childId})) beforeFocus?.();
  }, [activation, beforeFocus, childId, regionId, registry, request, revision]);
}
