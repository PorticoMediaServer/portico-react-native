import React, {createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {View, type NativeScrollEvent, type NativeSyntheticEvent} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {announce} from './announce';
import {Button} from './Button';
import {uiI18n} from './i18n';
import {Text} from './Text';
import {useTheme} from './theme';

/**
 * The iPhone and iPad navigation bar of a pushed screen (Justin, 2 Oct 2026): once the page's own
 * header (or a title page's hero) has scrolled away, a solid bar with Back and the title takes its
 * place, so content never runs under the clock or the Dynamic Island and the way back is always
 * in reach.
 *
 * Every stack screen is wrapped in a `NavScope`. The screen's scrollable reports its offset
 * (`useReportScroll`); whatever knows the screen's title and way back registers them
 * (`useNavTitle`: the page header, or a title page's status-bar scrim). Listeners hear only when
 * the offset crosses their own threshold, so scrolling re-renders nothing else.
 */
type Nav = Readonly<{title: string; onBack?: () => void; /** How far the page scrolls before the bar appears. */ after: number}>;
type Watcher = {threshold: number; past: boolean; changed: () => void};

class NavStore {
  private y = 0;
  private nav: Nav | null = null;
  private watchers = new Set<Watcher>();
  private navListeners = new Set<() => void>();
  report = (y: number) => {
    this.y = y;
    for (const w of this.watchers) {
      const past = y > w.threshold;
      if (past !== w.past) { w.past = past; w.changed(); }
    }
  };
  watch = (threshold: number, changed: () => void) => {
    const w: Watcher = {threshold, past: this.y > threshold, changed};
    this.watchers.add(w);
    return {isPast: () => w.past, stop: () => { this.watchers.delete(w); }};
  };
  getNav = () => this.nav;
  setNav = (nav: Nav | null) => {
    const same = this.nav?.title === nav?.title && this.nav?.after === nav?.after && this.nav?.onBack === nav?.onBack;
    if (same) return;
    this.nav = nav;
    for (const l of this.navListeners) l();
  };
  subscribeNav = (listener: () => void) => { this.navListeners.add(listener); return () => { this.navListeners.delete(listener); }; };
}

const NavContext = createContext<NavStore | null>(null);

/** A scrollable's `onScroll`: tells the screen's bar how far the page has moved. No-op outside a scope and on television. */
export function useReportScroll(): (event: NativeSyntheticEvent<NativeScrollEvent>) => void {
  const store = useContext(NavContext);
  return useMemo(() => (store ? (event: NativeSyntheticEvent<NativeScrollEvent>) => store.report(event.nativeEvent.contentOffset.y) : () => {}), [store]);
}

/** Whether the screen has scrolled past `threshold` points. Re-renders only when that changes. */
export function useScrolledPast(threshold: number): boolean {
  const store = useContext(NavContext);
  const watcher = useRef<{isPast: () => boolean; stop: () => void} | null>(null);
  const subscribe = useMemo(() => (changed: () => void) => {
    if (!store) return () => {};
    watcher.current = store.watch(threshold, changed);
    return () => { watcher.current?.stop(); watcher.current = null; };
  }, [store, threshold]);
  return useSyncExternalStore(subscribe, () => watcher.current?.isPast() ?? false);
}

/**
 * How a screen tells the shell its name, so a screen reader hears where it has arrived (the
 * shell's screen wrapper provides this; outside one, nothing is reported).
 */
export const ScreenTitleContext = createContext<((title: string | undefined) => void) | null>(null);

/**
 * Speaks a change on a screen (a new error, an empty state) to a screen reader. Inside a shell
 * screen this speaks only while that screen is the current one; elsewhere it always speaks.
 */
export const ScreenSpeechContext = createContext<(text: string) => void>(announce);

/** Names the screen for a screen reader. Screens with a page header or a title hero are named by those. */
export function useScreenTitle(title: string | undefined): void {
  const report = useContext(ScreenTitleContext);
  useEffect(() => { report?.(title); }, [report, title]);
}

/** Names the pushed screen for its bar: the title and the way back. `after` is where the bar takes over. */
export function useNavTitle(title: string | undefined, onBack: (() => void) | undefined, after = 56) {
  useScreenTitle(title);
  const store = useContext(NavContext);
  const back = useRef(onBack);
  back.current = onBack;
  const goBack = useMemo(() => () => back.current?.(), []);
  const pushed = !!onBack;
  useEffect(() => {
    if (!store || !title || !pushed) return;
    store.setNav({title, onBack: goBack, after});
    return () => store.setNav(null);
  }, [store, title, pushed, goBack, after]);
}

/** One screen's scope: its content, and the bar over it once the page has scrolled. */
export function NavScope({children}: {children: React.ReactNode}) {
  const {isTV} = useTheme();
  const store = useMemo(() => new NavStore(), []);
  if (isTV) return <>{children}</>;
  return (
    <NavContext.Provider value={store}>
      <View style={{flex: 1}}>
        {children}
        <ScopeBar store={store} />
      </View>
    </NavContext.Provider>
  );
}

function ScopeBar({store}: {store: NavStore}) {
  const nav = useSyncExternalStore(store.subscribeNav, store.getNav);
  // A title page's hero runs under the status bar on purpose (its scrim keeps the clock readable);
  // every other screen gets a solid backing there as soon as its content moves.
  const hero = !!nav && nav.after > 100;
  return (
    <>
      {hero ? null : <StatusBacking />}
      {nav ? <BarWhenScrolled nav={nav} /> : null}
    </>
  );
}

/** The status bar's backing on a scrolled screen: grids and lists never show through the clock or the Dynamic Island. */
function StatusBacking() {
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  const past = useScrolledPast(4);
  return past && insets.top ? <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: colors.ink}} /> : null;
}

function BarWhenScrolled({nav}: {nav: Nav}) {
  const past = useScrolledPast(nav.after);
  return past ? <NavBar title={nav.title} onBack={nav.onBack} /> : null;
}

/** The bar itself: the status-bar inset plus one 44-point row, Back on the left and the title centred. */
export function NavBar({title, onBack}: {title: string; onBack?: () => void}) {
  const {colors, space} = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top, backgroundColor: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.lineSoft}}>
      <View style={{height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm}}>
        <View style={{width: 64, alignItems: 'flex-start'}}>
          {onBack ? <Button variant="ghost" round size="sm" icon="back" accessibilityLabel={uiI18n().t('action.back')} onPress={onBack} /> : null}
        </View>
        <Text variant="bodyStrong" lines={1} align="center" style={{flex: 1}}>{title}</Text>
        <View style={{width: 64}} />
      </View>
    </View>
  );
}
