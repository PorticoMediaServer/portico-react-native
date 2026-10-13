import {useEffect} from 'react';
import {NativeModules, Platform} from 'react-native';

/**
 * Handoff, Spotlight and Siri (iOS; calls are harmless no-ops on tvOS).
 *
 * - `useCurrentActivity(title)` on a title's Detail screen and in the player: the iPhone/iPad
 *   advertises what you're looking at, so Handoff can continue it on the Mac (in Portico on the
 *   web when `webUrl` is given), Spotlight can suggest it again, and Siri learns the habit.
 * - `indexTitles(...)` after Home loads: Continue Watching and Saved become Spotlight results and
 *   the titles Siri can play ("Play The Bear in Portico", "Resume Portico").
 * - `clearActivity()` on sign-out or profile switch: removes everything this device indexed.
 *
 * Tapping a Spotlight result or a Siri "Play …" opens `portico://item/{id}` or
 * `portico://play/{id}`, the same routes the Top Shelf uses.
 */
export type ActivityTitle = {
  itemId: string;
  title: string;
  /** "Film · 2019", "Series · S2 E4 · Episode title". */
  subtitle?: string;
  /** `https://…` page for this title in Portico on the web, for Handoff to a Mac. */
  webUrl?: string;
};
export type IndexedTitles = {continueWatching: readonly ActivityTitle[]; saved: readonly ActivityTitle[]};

type Native = {setCurrent(title: ActivityTitle | null): void; indexTitles(titles: IndexedTitles): void; clear(): void};
const native = Platform.OS === 'ios' && !Platform.isTV ? (NativeModules.PorticoActivity as Native | undefined) : undefined;

/** Whether this device keeps such an index at all (iPhone and iPad). */
export const indexesTitles: boolean = !!native;

export function useCurrentActivity(title: ActivityTitle | null): void {
  const key = title ? JSON.stringify(title) : '';
  useEffect(() => {
    if (!native || !title) return;
    native.setCurrent(title);
    return () => native.setCurrent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** At most 50 of each list are kept; call again whenever Home refreshes. */
export function indexTitles(titles: IndexedTitles): void {
  native?.indexTitles({continueWatching: titles.continueWatching.slice(0, 50), saved: titles.saved.slice(0, 50)});
}

export function clearActivity(): void { native?.clear(); }
