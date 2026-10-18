import React, {Suspense, useState} from 'react';
import {Platform, StyleSheet, TVFocusGuideView, View} from 'react-native';
import {createNavigatorFactory, TabRouter, useNavigationBuilder, type ParamListBase, type TabNavigationState, type TabRouterOptions} from '@react-navigation/native';

/**
 * APL-SHELL-08: the app's destinations (Home, a library, Saved, Live TV…) as kept-alive roots,
 * each with its own stack. Choosing a destination shows it as it was left (its data, scroll
 * position and pushed pages), with no refetch and no skeleton; choosing the one already showing
 * goes back to its top. A root mounts the first time it is chosen and stays mounted after;
 * the ones not showing are hidden (`display: none`), so television focus never reaches them.
 *
 * Television: each root is its own focus guide, remembering the control last used in it. Right
 * from the rail goes back to that control in the root showing. One guide for every root (the
 * content's, before) remembered whichever control was used last anywhere: back on Home after a
 * library, it put focus on that library's card, hidden but still mounted, which Android accepts
 * (a view's own visibility counts, not its hidden ancestor's), so nothing on screen had focus.
 *
 * Only the tab router's state machine is used: no tab bar is drawn here (the shell draws its
 * own bottom bar and rail).
 */
// Suspending a hidden root retains its navigation and scroll state while React holds
// context/state renders until the root is visible again. The active player lives outside it.
const hiddenRoot = new Promise<void>(() => {});
function RootActivity({active, children}: {active: boolean; children: React.ReactNode}) {
  if (!active) throw hiddenRoot;
  return children;
}

function RootsNavigator({id, initialRouteName, children, screenOptions}: {id?: string; initialRouteName?: string; children: React.ReactNode; screenOptions?: object}) {
  const {state, descriptors, NavigationContent} = useNavigationBuilder<TabNavigationState<ParamListBase>, TabRouterOptions, Record<string, never>, object, Record<string, never>>(TabRouter, {id, initialRouteName, children, screenOptions, backBehavior: 'none'});
  const focusedKey = state.routes[state.index]?.key;
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set(focusedKey ? [focusedKey] : []));
  if (focusedKey && !mounted.has(focusedKey)) setMounted(new Set(mounted).add(focusedKey));
  return (
    <NavigationContent>
      <View style={styles.fill}>
        {state.routes.map(route => (mounted.has(route.key) || route.key === focusedKey ? (
          <View key={route.key} style={route.key === focusedKey ? StyleSheet.absoluteFill : styles.hidden}>
            <RootFocus>
              <Suspense fallback={null}>
                <RootActivity active={route.key === focusedKey}>{descriptors[route.key].render()}</RootActivity>
              </Suspense>
            </RootFocus>
          </View>
        ) : null))}
      </View>
    </NavigationContent>
  );
}

/** Television: the root's own guide (entry goes back to the control last used in it, else its first). */
function RootFocus({children}: {children: React.ReactNode}) {
  if (!Platform.isTV) return children;
  return <TVFocusGuideView autoFocus style={styles.fill}>{children}</TVFocusGuideView>;
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  hidden: {...StyleSheet.absoluteFillObject, display: 'none'},
});

export const createRootsNavigator = createNavigatorFactory(RootsNavigator);
