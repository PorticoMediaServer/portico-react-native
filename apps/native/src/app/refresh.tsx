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
 * - A screen is not refreshed because time has passed. Screens that show the server's library and
 *   the profile's state are kept current by the event feed (`app/freshness`): they are read again
 *   in place when something they show has moved, on a phone and on a television alike.
 * - `auto: true` is for the few screens the feed says nothing about (what is on this device, a
 *   person's credits): coming back to one after more than five minutes, or returning to the app
 *   with one in front, refreshes it in the background. What was on screen stays while it does.
 */
export function usePullToRefresh(refresh: () => unknown, {busy, auto = false, staleMs = STALE_MS}: {busy?: boolean; auto?: boolean; /** How old the screen may be before coming back to it refreshes it. Home passes a short time: it is where what you just watched shows up. */ staleMs?: number} = {}): React.ReactElement<RefreshControlProps> | undefined {
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
