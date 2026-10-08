import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, RefreshControl, type RefreshControlProps} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useTheme} from '../ui';

/** A screen that has not been refreshed for this long refreshes itself when it comes back. */
const STALE_MS = 5 * 60 * 1000;

/**
 * APL-SYS-07: how a destination refreshes, without a Refresh button in its header.
 *
 * - iPhone and iPad: the system pull-to-refresh (pass the result as the scroller's
 *   `refreshControl`). The spinner stays until `refresh`'s promise settles, or, for a refresh
 *   that returns nothing, until `busy` has come and gone.
 * - Everywhere (and the only way on television): a screen that comes back into focus, or an app
 *   that returns to the foreground, after more than five minutes refreshes in the background.
 *   What was on screen stays there while it does. `auto: false` turns this off for a screen whose
 *   refresh would lose the viewer's place (a windowed grid starts a new generation at the top).
 */
export function usePullToRefresh(refresh: () => unknown, {busy, auto = true, staleMs = STALE_MS}: {busy?: boolean; auto?: boolean; /** How old the screen may be before coming back to it refreshes it. Home passes a short time: it is where what you just watched shows up. */ staleMs?: number} = {}): React.ReactElement<RefreshControlProps> | undefined {
  const {isTV, colors} = useTheme();
  const [pulling, setPulling] = useState(false);
  const last = useRef(Date.now());
  const latest = useRef(refresh);
  latest.current = refresh;
  const run = useCallback(() => {
    last.current = Date.now();
    return Promise.resolve(latest.current()).catch(() => {});
  }, []);

  // A pull whose refresh returned nothing ends when the screen's own busy flag clears (or after a
  // moment, if the screen never reports one).
  const waitingForBusy = useRef(false);
  const onRefresh = useCallback(() => {
    setPulling(true);
    const result = latest.current();
    last.current = Date.now();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void (result as Promise<unknown>).catch(() => {}).finally(() => setPulling(false));
    } else {
      waitingForBusy.current = true;
    }
  }, []);
  useEffect(() => {
    if (!pulling || !waitingForBusy.current) return;
    if (busy) return;
    const t = setTimeout(() => { waitingForBusy.current = false; setPulling(false); }, 600);
    return () => clearTimeout(t);
  }, [pulling, busy]);

  const navigation = useNavigation();
  useEffect(() => {
    if (!auto) return;
    const stale = () => Date.now() - last.current > staleMs;
    const focus = navigation.addListener('focus', () => { if (stale()) void run(); });
    const app = AppState.addEventListener('change', s => { if (s === 'active' && navigation.isFocused() && stale()) void run(); });
    return () => { focus(); app.remove(); };
  }, [navigation, run, auto, staleMs]);

  if (isTV) return undefined;
  return <RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={colors.textSecondary} />;
}
