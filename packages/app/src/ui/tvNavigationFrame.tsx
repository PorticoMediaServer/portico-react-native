import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  StyleSheet,
  TVFocusGuideView,
  View,
  useTVEventHandler,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {getFocusedRouteNameFromRoute} from '@react-navigation/native';
import {
  PorticoBrand,
  PorticoIcon,
  type PorticoIconId,
} from '@portico-react-native/icons';
import {useLibraryCatalog} from '../data/library';
import {Focusable, type TVFocusNode} from './primitives';
import {usePrototypeUi} from './uiState';
import {PorticoWordmark} from './sharedComponents';
import {color, font} from './tokens';
import {useReducedMotion} from './useReducedMotion';
import {productText} from './productCopy';
import {TvContentInsetProvider} from './shells';
import {
  recallTVNavigationFocusId,
  revealTVNavigationFocusId,
} from './tvNavigationFocus';
import {
  TVRailFocusHandoff,
  tvRailHandoffCanComplete,
  type TVRailFocusTerminal,
} from './tvRailFocusHandoff';
import {
  TVNavigationRailBridge,
  type TVRailTabModel,
  type TVTabBarNavigation,
  type TVTabBarState,
} from './tvNavigationRail';
import {
  TV_COLLAPSED_CONTENT_INSET,
  TV_EXPANDED_CONTENT_INSET,
  TV_FRAME_GEOMETRY,
} from './tv/frameGeometry';
import type {TVRailOpenOrigin} from './tvNavigationBack';

type AnimatedInset = Animated.Value | Animated.AnimatedInterpolation<number>;

export function pinnedTVLibraryDestinations<T>(
  libraries: readonly T[],
  limit = 4,
): {pinned: T[]; showAll: boolean} {
  return {pinned: libraries.slice(0, limit), showAll: libraries.length > limit};
}

interface TVFrameContextValue {
  contentInset: AnimatedInset;
  forget(scope: string, target: TVFocusNode, semanticId?: string): void;
  register(scope: string, target: TVFocusNode, semanticId?: string): void;
  contentFocused(): void;
  closeRailAndRestore(): void;
  railState(): {open: boolean; origin: TVRailOpenOrigin};
  requestRailFocus(origin?: Exclude<TVRailOpenOrigin, 'none'>): void;
  restoreActiveScopeFocus(): void;
}

const TVFrameContext = createContext<TVFrameContextValue | undefined>(
  undefined,
);

export function TVNavigationFrameProvider({
  activeScope,
  children,
}: {
  activeScope: string;
  children: React.ReactNode;
}) {
  const {railExpanded: expanded, setRailExpanded: setExpanded} =
    usePrototypeUi();
  const reducedMotion = useReducedMotion();
  const railFocused = useRef(false);
  const railOrigin = useRef<TVRailOpenOrigin>('none');
  const [handoffLocked, setHandoffLocked] = useState(false);
  const [railFocusRequestKey, setRailFocusRequestKey] = useState(0);
  const handoff = useRef(new TVRailFocusHandoff<TVFocusNode>()).current;
  const handoffToken = useRef<number | undefined>(undefined);
  const handoffFocusEpoch = useRef(0);
  const railFocusEpoch = useRef(0);
  const expandedRef = useRef(expanded);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const focusFrame = useRef<number | undefined>(undefined);
  const mountedTargets = useRef(new Map<string, TVFocusNode[]>());
  const semanticTargets = useRef(new Map<string, Map<string, TVFocusNode>>());
  const width = useRef(
    new Animated.Value(TV_FRAME_GEOMETRY.railCollapsedWidth),
  ).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;
  const animatedExpanded = useRef(expanded);
  expandedRef.current = expanded;

  const contentInset = width.interpolate({
    inputRange: [
      TV_FRAME_GEOMETRY.railCollapsedWidth,
      TV_FRAME_GEOMETRY.railExpandedWidth,
    ],
    outputRange: [TV_COLLAPSED_CONTENT_INSET, TV_EXPANDED_CONTENT_INSET],
  });

  const completeHandoff = useCallback(
    (target: TVFocusNode) => {
      if (focusFrame.current !== undefined)
        cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = undefined;
        const token = handoffToken.current;
        if (
          token === undefined ||
          !tvRailHandoffCanComplete({
            collapseFocusEpoch: handoffFocusEpoch.current,
            currentFocusEpoch: railFocusEpoch.current,
            currentToken: token,
            expanded: expandedRef.current,
            token,
          }) ||
          !handoff.isCurrent(token)
        )
          return;
        const mounted = mountedTargets.current.get(activeScope) ?? [];
        const current = mounted.includes(target) ? target : mounted[0];
        if (!current?.requestTVFocus) {
          handoff.replaceTarget(target, undefined);
          return;
        }
        if (current !== target) handoff.replaceTarget(target, current);
        if (!handoff.complete(current)) return;
        handoffToken.current = undefined;
        current.requestTVFocus();
        setHandoffLocked(false);
      });
    },
    [activeScope, handoff],
  );

  const beginRailToContentHandoff = useCallback(() => {
    if (!expandedRef.current) return;
    const rememberedId = recallTVNavigationFocusId(activeScope);
    const target =
      (rememberedId
        ? semanticTargets.current.get(activeScope)?.get(rememberedId)
        : undefined) ?? mountedTargets.current.get(activeScope)?.[0];
    handoffToken.current = handoff.begin(target);
    handoffFocusEpoch.current = railFocusEpoch.current;
    setHandoffLocked(true);
    railOrigin.current = 'none';
    expandedRef.current = false;
    setExpanded(false);
  }, [activeScope, handoff, setExpanded]);

  useTVEventHandler(event => {
    if (!expanded || !railFocused.current || event.eventType !== 'right')
      return;
    beginRailToContentHandoff();
  });

  useLayoutEffect(() => {
    if (animatedExpanded.current === expanded) {
      width.setValue(
        expanded
          ? TV_FRAME_GEOMETRY.railExpandedWidth
          : TV_FRAME_GEOMETRY.railCollapsedWidth,
      );
      labelOpacity.setValue(expanded ? 1 : 0);
      if (!handoff.active) setHandoffLocked(false);
      return;
    }
    animatedExpanded.current = expanded;
    if (expanded) {
      handoff.abandon(handoffToken.current);
      handoffToken.current = undefined;
      setHandoffLocked(false);
    }
    const collapseToken = expanded ? undefined : handoffToken.current;
    Animated.parallel([
      Animated.timing(width, {
        duration: reducedMotion ? 0 : 160,
        toValue: expanded
          ? TV_FRAME_GEOMETRY.railExpandedWidth
          : TV_FRAME_GEOMETRY.railCollapsedWidth,
        useNativeDriver: false,
      }),
      Animated.timing(labelOpacity, {
        duration: reducedMotion ? 0 : 130,
        toValue: expanded ? 1 : 0,
        useNativeDriver: false,
      }),
    ]).start(({finished}) => {
      if (expanded || collapseToken === undefined) return;
      if (
        !tvRailHandoffCanComplete({
          collapseFocusEpoch: handoffFocusEpoch.current,
          currentFocusEpoch: railFocusEpoch.current,
          currentToken: handoffToken.current,
          expanded: expandedRef.current,
          token: collapseToken,
        })
      ) {
        if (handoff.abandon(collapseToken)) {
          handoffToken.current = undefined;
          setHandoffLocked(false);
        }
        return;
      }
      const terminal: TVRailFocusTerminal = finished
        ? 'completed'
        : 'interrupted';
      const target = handoff.terminalize(collapseToken, terminal);
      if (target) completeHandoff(target);
    });
  }, [completeHandoff, expanded, handoff, labelOpacity, reducedMotion, width]);

  const collapseRail = useCallback(() => {
    if (!handoff.active) setHandoffLocked(false);
    setExpanded(false);
  }, [handoff, setExpanded]);

  const contentFocused = useCallback(() => {
    collapseRail();
  }, [collapseRail]);

  const register = useCallback(
    (scope: string, target: TVFocusNode, semanticId?: string) => {
      const targets = mountedTargets.current.get(scope) ?? [];
      if (!targets.includes(target)) targets.push(target);
      mountedTargets.current.set(scope, targets);
      if (semanticId) {
        const scopedTargets =
          semanticTargets.current.get(scope) ?? new Map<string, TVFocusNode>();
        scopedTargets.set(semanticId, target);
        semanticTargets.current.set(scope, scopedTargets);
      }
      if (scope !== activeScope) return;
      const completed = handoff.supplyTarget(target);
      if (completed) completeHandoff(completed);
    },
    [activeScope, completeHandoff, handoff],
  );

  const forget = useCallback(
    (scope: string, target: TVFocusNode, semanticId?: string) => {
      if (semanticId) {
        const scopedTargets = semanticTargets.current.get(scope);
        if (scopedTargets?.get(semanticId) === target)
          scopedTargets.delete(semanticId);
        if (!scopedTargets?.size) semanticTargets.current.delete(scope);
      }
      const targets = (mountedTargets.current.get(scope) ?? []).filter(
        candidate => candidate !== target,
      );
      if (targets.length) mountedTargets.current.set(scope, targets);
      else mountedTargets.current.delete(scope);
      if (scope !== activeScope) return;
      const completed = handoff.replaceTarget(target, targets[0]);
      if (completed) completeHandoff(completed);
    },
    [activeScope, completeHandoff, handoff],
  );

  const railFocus = useCallback(() => {
    if (blurTimer.current !== undefined) {
      clearTimeout(blurTimer.current);
      blurTimer.current = undefined;
    }
    railFocusEpoch.current += 1;
    if (handoff.abandon()) {
      handoffToken.current = undefined;
      setHandoffLocked(false);
    }
    railFocused.current = true;
    if (!expandedRef.current) railOrigin.current = 'content';
    expandedRef.current = true;
    setExpanded(true);
  }, [handoff, setExpanded]);

  const railBlur = useCallback(() => {
    if (blurTimer.current !== undefined) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => {
      blurTimer.current = undefined;
      railFocused.current = false;
    }, 180);
  }, []);

  const runRailAction = useCallback(
    (action: () => void) => {
      handoff.abandon();
      handoffToken.current = undefined;
      action();
      railOrigin.current = 'none';
      collapseRail();
    },
    [collapseRail, handoff],
  );

  const requestRailFocus = useCallback(
    (origin: Exclude<TVRailOpenOrigin, 'none'> = 'content') => {
      handoff.abandon();
      handoffToken.current = undefined;
      railOrigin.current = origin;
      expandedRef.current = true;
      setExpanded(true);
      setRailFocusRequestKey(key => key + 1);
    },
    [handoff, setExpanded],
  );

  const railState = useCallback(
    () => ({open: expandedRef.current, origin: railOrigin.current}),
    [],
  );

  const restoreActiveScopeFocus = useCallback(() => {
    const mounted = mountedTargets.current.get(activeScope) ?? [];
    const rememberedId = recallTVNavigationFocusId(activeScope);
    const remembered = rememberedId
      ? semanticTargets.current.get(activeScope)?.get(rememberedId)
      : undefined;
    const target =
      remembered && mounted.includes(remembered) ? remembered : mounted[0];
    if (target) target.requestTVFocus?.();
    else if (rememberedId) {
      void revealTVNavigationFocusId(rememberedId).then(revealed => {
        if (!revealed) return;
        requestAnimationFrame(() =>
          semanticTargets.current
            .get(activeScope)
            ?.get(rememberedId)
            ?.requestTVFocus?.(),
        );
      });
    }
  }, [activeScope]);

  useEffect(
    () => () => {
      if (blurTimer.current !== undefined) clearTimeout(blurTimer.current);
      if (focusFrame.current !== undefined)
        cancelAnimationFrame(focusFrame.current);
      width.stopAnimation();
      labelOpacity.stopAnimation();
      handoff.abandon();
    },
    [handoff, labelOpacity, width],
  );

  const value = useMemo<TVFrameContextValue>(
    () => ({
      contentInset,
      closeRailAndRestore: beginRailToContentHandoff,
      contentFocused,
      forget,
      register,
      railState,
      requestRailFocus,
      restoreActiveScopeFocus,
    }),
    [
      contentFocused,
      contentInset,
      beginRailToContentHandoff,
      forget,
      register,
      railState,
      requestRailFocus,
      restoreActiveScopeFocus,
    ],
  );
  return (
    <TVFrameContext.Provider value={value}>
      <TvContentInsetProvider value={contentInset}>
        <TVRailInteractionContext.Provider
          value={{
            expanded,
            handoffLocked,
            labelOpacity,
            railFocusRequestKey,
            railBlur,
            railFocus,
            runRailAction,
            width,
          }}
        >
          {children}
        </TVRailInteractionContext.Provider>
      </TvContentInsetProvider>
    </TVFrameContext.Provider>
  );
}

const TVRailInteractionContext = createContext<
  | {
      expanded: boolean;
      handoffLocked: boolean;
      labelOpacity: Animated.Value;
      railFocusRequestKey: number;
      railBlur(): void;
      railFocus(): void;
      runRailAction(action: () => void): void;
      width: Animated.Value;
    }
  | undefined
>(undefined);

export function useTVNavigationFrameActions() {
  const frame = useContext(TVFrameContext);
  if (!frame)
    throw new Error(
      'useTVNavigationFrameActions requires TVNavigationFrameProvider.',
    );
  return useMemo(
    () => ({
      closeRailAndRestore: frame.closeRailAndRestore,
      railState: frame.railState,
      requestRailFocus: frame.requestRailFocus,
      restoreActiveScopeFocus: frame.restoreActiveScopeFocus,
    }),
    [
      frame.closeRailAndRestore,
      frame.railState,
      frame.requestRailFocus,
      frame.restoreActiveScopeFocus,
    ],
  );
}

/** Render helper used by TVNavigationFocusBoundary to share rail handoff callbacks. */
export function useTVNavigationSceneFocus(scope: string) {
  const frame = useContext(TVFrameContext);
  if (!frame)
    throw new Error(
      'useTVNavigationSceneFocus requires TVNavigationFrameProvider.',
    );
  return useMemo(
    () => ({
      onContentFocus: () => frame.contentFocused(),
      onContentMount: (node: TVFocusNode, semanticId?: string) =>
        frame.register(scope, node, semanticId),
      onContentUnmount: (node: TVFocusNode, semanticId?: string) =>
        frame.forget(scope, node, semanticId),
    }),
    [frame, scope],
  );
}

export function TVNavigationSceneLayout({
  children,
  fullBleed = false,
  style,
}: {
  children: React.ReactNode;
  fullBleed?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const frame = useContext(TVFrameContext);
  if (!frame)
    throw new Error(
      'TVNavigationSceneLayout requires TVNavigationFrameProvider.',
    );
  return (
    <TVFocusGuideView autoFocus style={styles.sceneFocusGuide}>
      {fullBleed ? (
        children
      ) : (
        <Animated.View
          style={[
            styles.sceneContent,
            {paddingLeft: frame.contentInset},
            style,
          ]}
        >
          {children}
        </Animated.View>
      )}
    </TVFocusGuideView>
  );
}

export function PorticoTVTabBar(props: BottomTabBarProps) {
  const {restoreActiveScopeFocus} = useTVNavigationFrameActions();
  const activeTab = props.state.routes[props.state.index];
  if (activeTab && getFocusedRouteNameFromRoute(activeTab) === 'Player')
    return null;
  return (
    <TVNavigationRailBridge
      navigation={props.navigation as unknown as TVTabBarNavigation}
      onReselect={restoreActiveScopeFocus}
      state={props.state as unknown as TVTabBarState}
    >
      {model => <TVRailPresentation model={model} />}
    </TVNavigationRailBridge>
  );
}

function TVRailPresentation({model}: {model: TVRailTabModel}) {
  const interactions = useContext(TVRailInteractionContext);
  if (!interactions)
    throw new Error('PorticoTVTabBar requires TVNavigationFrameProvider.');
  const {
    expanded,
    handoffLocked,
    labelOpacity,
    railFocusRequestKey,
    railBlur,
    railFocus,
    runRailAction,
    width,
  } = interactions;
  const {
    libraryTab,
    selectedLibraryId,
    setLibraryTab,
    setOverlay,
    setSelectedLibraryId,
    setTVAccountHubOpen,
  } = usePrototypeUi();
  const catalog = useLibraryCatalog(selectedLibraryId);
  const libraryDestinations = pinnedTVLibraryDestinations(
    catalog.data?.libraries ?? [],
  );
  const home = model.items.find(item => item.name === 'Home');
  const remaining = model.items.filter(item => item.name !== 'Home');

  useEffect(() => {
    const available = catalog.data?.libraries ?? [];
    if (
      !available.length ||
      available.some(library => library.id === selectedLibraryId)
    )
      return;
    setSelectedLibraryId(available[0]!.id);
    setLibraryTab(available[0]!.tabs[0]?.label ?? 'Discover');
  }, [
    catalog.data?.libraries,
    selectedLibraryId,
    setLibraryTab,
    setSelectedLibraryId,
  ]);

  const navigation = useTVRailNavigationActions();
  return (
    <Animated.View
      style={[styles.rail, {width}]}
      testID="portico-four-tv-navigation"
    >
      <View style={styles.railBrand}>
        {expanded ? (
          <PorticoWordmark platform="tv" />
        ) : (
          <View style={styles.collapsedMark}>
            <PorticoBrand height={28} id="brand.play-p.mono-white" width={21} />
          </View>
        )}
      </View>
      <TVFocusGuideView
        autoFocus
        key={`rail-focus-${railFocusRequestKey}`}
        trapFocusLeft
        trapFocusRight={expanded || handoffLocked}
        style={styles.railFocusGuide}
      >
        <View style={styles.railItems}>
          {home ? (
            <RailItem
              expanded={expanded}
              icon="navigation.home"
              id={home.key}
              label={productText('navigation.home')}
              labelOpacity={labelOpacity}
              onBlur={railBlur}
              onFocus={railFocus}
              onPress={() => runRailAction(home.onPress)}
              selected={home.focused}
            />
          ) : null}
          <RailItem
            expanded={expanded}
            icon="navigation.search"
            id="search"
            label={productText('navigation.search')}
            labelOpacity={labelOpacity}
            onBlur={railBlur}
            onFocus={railFocus}
            onPress={() => runRailAction(navigation.openSearch)}
            selected={navigation.routeName === 'Search'}
          />
          {remaining.map(item => (
            <RailItem
              expanded={expanded}
              icon={
                item.name === 'Library'
                  ? 'navigation.library'
                  : item.name === 'Channels'
                    ? 'navigation.channels'
                    : 'navigation.saved'
              }
              id={item.key}
              key={item.key}
              label={
                item.name === 'Library'
                  ? 'Library'
                  : item.name === 'Channels'
                    ? 'Channels'
                    : productText('navigation.saved')
              }
              labelOpacity={labelOpacity}
              onBlur={railBlur}
              onFocus={railFocus}
              onPress={() => runRailAction(item.onPress)}
              selected={item.focused}
            />
          ))}
        </View>
        <View style={styles.railDivider} />
        <View style={styles.railLibraries}>
          {libraryDestinations.pinned.map(library => (
            <RailItem
              expanded={expanded}
              icon={libraryIcon(library.kind)}
              id={`library:${library.id}`}
              key={library.id}
              label={library.name}
              labelOpacity={labelOpacity}
              onBlur={railBlur}
              onFocus={railFocus}
              onPress={() =>
                runRailAction(() => {
                  setSelectedLibraryId(library.id);
                  setLibraryTab(
                    library.tabs[0]?.label ?? libraryTab ?? 'Discover',
                  );
                  navigation.openLibrary();
                })
              }
              selected={
                model.activeName === 'Library' &&
                selectedLibraryId === library.id
              }
            />
          ))}
          {libraryDestinations.showAll ? (
            <RailItem
              expanded={expanded}
              icon="library.collection"
              id="library:all"
              label="All Libraries"
              labelOpacity={labelOpacity}
              onBlur={railBlur}
              onFocus={railFocus}
              onPress={() =>
                runRailAction(() => {
                  navigation.openLibrary();
                  setOverlay('library');
                })
              }
              selected={false}
            />
          ) : null}
        </View>
        <View style={styles.railBottom}>
          <RailItem
            expanded={expanded}
            icon="account.user"
            id="profile"
            label={productText('profiles.label.profile')}
            labelOpacity={labelOpacity}
            onBlur={railBlur}
            onFocus={railFocus}
            onPress={() => runRailAction(() => setTVAccountHubOpen(true))}
            selected={false}
          />
          <RailItem
            expanded={expanded}
            icon="navigation.settings"
            id="settings"
            label={productText('settings.title')}
            labelOpacity={labelOpacity}
            onBlur={railBlur}
            onFocus={railFocus}
            onPress={() => runRailAction(navigation.openSettings)}
            selected={navigation.routeName === 'Settings'}
          />
        </View>
      </TVFocusGuideView>
    </Animated.View>
  );
}

interface TVRailNavigationActions {
  openLibrary(): void;
  openSearch(): void;
  openSettings(): void;
  routeName?: string;
}

const TVRailNavigationContext = createContext<
  TVRailNavigationActions | undefined
>(undefined);

export function TVRailNavigationProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: TVRailNavigationActions;
}) {
  return (
    <TVRailNavigationContext.Provider value={value}>
      {children}
    </TVRailNavigationContext.Provider>
  );
}

function useTVRailNavigationActions(): TVRailNavigationActions {
  const context = useContext(TVRailNavigationContext);
  if (!context)
    throw new Error('PorticoTVTabBar requires TVRailNavigationProvider.');
  return context;
}

function RailItem({
  expanded,
  icon,
  id,
  label,
  labelOpacity,
  onBlur,
  onFocus,
  onPress,
  selected,
}: {
  expanded: boolean;
  icon: PorticoIconId;
  id: string;
  label: string;
  labelOpacity: Animated.Value;
  onBlur(): void;
  onFocus(): void;
  onPress(): void;
  selected: boolean;
}) {
  return (
    <Focusable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{selected}}
      onBlur={onBlur}
      onFocus={onFocus}
      onPress={onPress}
      platform="tv"
      style={[
        styles.railItem,
        expanded && styles.railItemExpanded,
        selected && styles.railItemSelected,
      ]}
      focusedStyle={styles.railItemFocused}
      pressedStyle={styles.railItemPressed}
      tvFocusId={`rail:${id}`}
    >
      <View style={styles.railIconFrame}>
        <PorticoIcon
          color={selected ? color.screenBlueStrong : color.softSilver}
          id={icon}
          size={28}
          state={selected ? 'selected' : 'default'}
        />
      </View>
      <Animated.Text
        numberOfLines={1}
        style={[styles.railLabel, {opacity: labelOpacity}]}
      >
        {label}
      </Animated.Text>
      {selected ? <View style={styles.railSelection} /> : null}
    </Focusable>
  );
}

function libraryIcon(kind: string): PorticoIconId {
  switch (kind) {
    case 'movies':
      return 'media.movie';
    case 'tv':
    case 'anime':
      return 'media.video';
    case 'music':
      return 'media.music';
    case 'audiobooks':
      return 'media.audiobook';
    default:
      return 'library.collection';
  }
}

const styles = StyleSheet.create({
  sceneFocusGuide: {flex: 1},
  sceneContent: {flex: 1, minWidth: 0},
  rail: {
    backgroundColor: color.projector,
    borderRightColor: color.line,
    borderRightWidth: 1,
    bottom: 0,
    left: TV_FRAME_GEOMETRY.railLeft,
    overflow: 'hidden',
    paddingBottom: 40,
    paddingHorizontal: 8,
    paddingTop: 40,
    position: 'absolute',
    top: 0,
    zIndex: 70,
  },
  railBrand: {
    alignItems: 'flex-start',
    height: 58,
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  collapsedMark: {
    alignItems: 'center',
    backgroundColor: color.screenBlueDeep,
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  railFocusGuide: {flex: 1},
  railItems: {gap: 4},
  railDivider: {
    backgroundColor: color.line,
    height: 1,
    marginHorizontal: 10,
    marginVertical: 10,
  },
  railLibraries: {gap: 2},
  railBottom: {gap: 2, marginTop: 'auto'},
  railItem: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 3,
    flexDirection: 'row',
    height: 64,
    overflow: 'hidden',
    paddingHorizontal: 8,
    position: 'relative',
  },
  railItemExpanded: {paddingRight: 14},
  railItemSelected: {backgroundColor: color.raisedSlate},
  railItemFocused: {
    backgroundColor: color.brightSlate,
    borderColor: color.focus,
  },
  railItemPressed: {backgroundColor: color.recess},
  railIconFrame: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
    width: 42,
  },
  railLabel: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 21,
    lineHeight: 27,
    marginLeft: 12,
    width: 174,
  },
  railSelection: {
    backgroundColor: color.screenBlue,
    bottom: 8,
    left: 0,
    position: 'absolute',
    top: 8,
    width: 3,
  },
});
