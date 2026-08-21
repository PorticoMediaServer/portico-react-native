import {useEffect, useRef} from 'react';
import {AccessibilityInfo} from 'react-native';
import type {PorticoPlatformClass} from '@porticomediaserver/client-core';
import type {PorticoRoute} from './navigation';
import {productText} from './productCopy';

export type PorticoNavigationLifecycleEvent = {
  event: 'focus' | 'blur';
  platform: PorticoPlatformClass;
  route: PorticoRoute;
};

type NavigationLifecycleListener = (event: PorticoNavigationLifecycleEvent) => void;
const listeners = new Set<NavigationLifecycleListener>();

/** Telemetry can subscribe here without making navigation depend on a vendor SDK. */
export function subscribePorticoNavigationLifecycle(listener: NavigationLifecycleListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishPorticoNavigationLifecycle(event: PorticoNavigationLifecycleEvent): void {
  for (const listener of listeners) {
    try { listener(event); } catch { /* Observability must never break navigation. */ }
  }
}

export function porticoRouteAccessibilityLabel(route: PorticoRoute): string {
  switch (route.name) {
    case 'home': return productText('navigation.home');
    case 'library': return productText('navigation.libraries');
    case 'channels': return productText('navigation.live-tv');
    case 'saved': return productText('navigation.saved');
    case 'downloads': return productText('settings.section.downloads');
    case 'search': return productText('navigation.search');
    case 'settings': return productText('settings.title');
    case 'person': return productText('destination.person');
    case 'detail': return productText('destination.details');
    case 'player': return productText('action.play');
  }
}

/** Central focus/blur observation and screen-reader announcement. */
export function usePorticoNavigationLifecycle(
  route: PorticoRoute,
  platform: PorticoPlatformClass,
  enabled = true,
): void {
  const previous = useRef<PorticoRoute | undefined>(undefined);
  const announcementGeneration = useRef(0);
  useEffect(() => {
    if (!enabled) {
      const oldRoute = previous.current;
      if (oldRoute) publishPorticoNavigationLifecycle({event: 'blur', platform, route: oldRoute});
      previous.current = undefined;
      // Invalidate a screen-reader check already in flight for a product
      // route that was replaced by Account, Profile, or Fail Closed.
      announcementGeneration.current += 1;
      return;
    }
    const oldRoute = previous.current;
    if (oldRoute) publishPorticoNavigationLifecycle({event: 'blur', platform, route: oldRoute});
    previous.current = route;
    publishPorticoNavigationLifecycle({event: 'focus', platform, route});
    const generation = ++announcementGeneration.current;
    void AccessibilityInfo.isScreenReaderEnabled().then(screenReaderEnabled => {
      if (screenReaderEnabled && announcementGeneration.current === generation) {
        AccessibilityInfo.announceForAccessibility(porticoRouteAccessibilityLabel(route));
      }
    }).catch(() => undefined);
  }, [enabled, platform, route]);
}
