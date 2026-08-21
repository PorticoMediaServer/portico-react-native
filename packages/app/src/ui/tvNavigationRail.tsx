import React, {useCallback, useMemo} from 'react';
import type {TVPrimaryRouteName} from './tvNavigationPolicy';
import {isTVPrimaryRoute} from './tvNavigationPolicy';

export interface TVTabRoute {
  key: string;
  name: string;
  params?: Readonly<Record<string, unknown>>;
}

export interface TVTabBarNavigation {
  emit(event: {
    canPreventDefault?: boolean;
    target?: string;
    type: 'tabLongPress' | 'tabPress';
  }): {defaultPrevented?: boolean};
  navigate(name: string, params?: Readonly<Record<string, unknown>>): void;
}

export interface TVTabBarState {
  index: number;
  routes: readonly TVTabRoute[];
}

export interface TVRailTabItem {
  accessibilityState: {selected: boolean};
  focused: boolean;
  key: string;
  label: string;
  name: TVPrimaryRouteName;
  onLongPress(): void;
  onPress(): void;
}

export interface TVRailTabModel {
  activeName: TVPrimaryRouteName;
  items: readonly TVRailTabItem[];
}

export type TVTabLabelResolver = (route: TVTabRoute) => string;

/**
 * React Navigation tab-bar adapter with no visual opinions. The Portico rail
 * renders this model, preserving its expansion and focus behavior while the
 * standard tab router owns selected state and tab events.
 */
export function createTVRailTabModel(
  state: TVTabBarState,
  navigation: TVTabBarNavigation,
  resolveLabel: TVTabLabelResolver = route => route.name,
  onReselect: (name: TVPrimaryRouteName) => void = () => undefined,
): TVRailTabModel {
  const activeRoute = state.routes[state.index];
  if (!activeRoute || !isTVPrimaryRoute(activeRoute.name)) {
    throw new Error('The tvOS tab navigator must expose an active Portico primary route.');
  }

  const items = state.routes.flatMap<TVRailTabItem>((route, index) => {
    if (!isTVPrimaryRoute(route.name)) return [];
    const name = route.name;
    const focused = index === state.index;
    return [{
      accessibilityState: {selected: focused},
      focused,
      key: route.key,
      label: resolveLabel(route),
      name,
      onLongPress: () => navigation.emit({target: route.key, type: 'tabLongPress'}),
      onPress: () => {
        if (focused) {
          onReselect(name);
          return;
        }
        const event = navigation.emit({
          canPreventDefault: true,
          target: route.key,
          type: 'tabPress',
        });
        if (!event.defaultPrevented) {
          navigation.navigate(name, route.params);
        }
      },
    }];
  });

  return {activeName: activeRoute.name, items};
}

export function TVNavigationRailBridge({
  children,
  navigation,
  onReselect,
  resolveLabel,
  state,
}: {
  children(model: TVRailTabModel): React.ReactNode;
  navigation: TVTabBarNavigation;
  onReselect?(name: TVPrimaryRouteName): void;
  resolveLabel?: TVTabLabelResolver;
  state: TVTabBarState;
}) {
  const label = useCallback<TVTabLabelResolver>(
    route => resolveLabel?.(route) ?? route.name,
    [resolveLabel],
  );
  const model = useMemo(
    () => createTVRailTabModel(state, navigation, label, onReselect),
    [label, navigation, onReselect, state],
  );
  return <>{children(model)}</>;
}
