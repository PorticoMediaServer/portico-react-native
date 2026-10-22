import type {Library} from '../../../../packages/client-core/src/index';
import type {IconName} from '../kit/Icon';

export type ShellScope = Readonly<{serverId: string; accountId: string; profileId: string}>;
export type ShellAuthority = ShellScope & Readonly<{epoch: string; viewerFence: string}>;
export type ShellDestination = Readonly<
  {kind: 'home' | 'search' | 'libraries' | 'live' | 'saved' | 'settings'} |
  {kind: 'library'; libraryId: string}
>;
export type ShellTab = Readonly<{id: 'home' | 'search' | 'libraries' | 'live' | 'saved'; icon: IconName; message: 'web.shell.home' | 'web.shell.search' | 'pins.libraries' | 'search.chip.liveTV' | 'saved.title'}>;

export const scopeKey = (scope: ShellScope): string => JSON.stringify([scope.serverId, scope.accountId, scope.profileId]);
export const authorityKey = (scope: ShellAuthority): string => JSON.stringify([scope.serverId, scope.accountId, scope.profileId, scope.epoch, scope.viewerFence]);
export const sameAuthority = (a: ShellAuthority, b: ShellAuthority): boolean => authorityKey(a) === authorityKey(b);

/** The API's user order is authoritative. This never sorts libraries by name or kind. */
export function visibleLibraries(libraries: readonly Library[], isTV: boolean): readonly Library[] {
  return isTV ? libraries.filter(library => library.kind !== 'books') : libraries;
}

export function phoneTabs(hasLiveTV: boolean): readonly ShellTab[] {
  return [
    {id: 'home', icon: 'i-home', message: 'web.shell.home'},
    {id: 'search', icon: 'i-search', message: 'web.shell.search'},
    {id: 'libraries', icon: 'i-grid', message: 'pins.libraries'},
    ...(hasLiveTV ? [{id: 'live', icon: 'i-tv', message: 'search.chip.liveTV'} as const] : []),
    {id: 'saved', icon: 'i-bookmark', message: 'saved.title'},
  ];
}

export function libraryIcon(kind: string): IconName {
  if (kind === 'movie') return 'i-film';
  if (kind === 'tv') return 'i-tvlib';
  if (kind === 'music') return 'i-music';
  if (kind === 'audiobook' || kind === 'books') return 'i-book';
  return 'i-category';
}

/** First use and a removed/unauthorized remembered id open the overview, even with one library. */
export function librariesDestination(remembered: string | undefined, libraries: readonly Library[]): ShellDestination {
  return remembered && libraries.some(library => library.id === remembered)
    ? {kind: 'library', libraryId: remembered} : {kind: 'libraries'};
}

export function selectedTab(destination: ShellDestination): ShellTab['id'] | undefined {
  return destination.kind === 'library' ? 'libraries' : destination.kind === 'settings' ? undefined : destination.kind;
}

export type ShellLayout = Readonly<{kind: 'phone' | 'tablet' | 'desktop' | 'tv'; panel: 'bottom' | 'side'; tabs: boolean; scale: number; left: number; top: number; width: number; height: number}>;
/** TV is one letterboxed 1920x1080 coordinate system, never separately enlarged text/cards. */
export function shellLayout(width: number, height: number, isTV: boolean): ShellLayout {
  if (isTV) {
    const scale = Math.min(width / 1920, height / 1080);
    return {kind: 'tv', panel: 'side', tabs: false, scale, left: (width - 1920 * scale) / 2, top: (height - 1080 * scale) / 2, width: 1920, height: 1080};
  }
  return {kind: width < 600 ? 'phone' : width < 1024 ? 'tablet' : 'desktop', panel: width < 600 ? 'bottom' : 'side', tabs: width < 1024, scale: 1, left: 0, top: 0, width, height};
}

/** The 84-point drawn bar includes the ordinary bottom safe area. Larger insets extend it. */
export const phoneBarHeight = (bottomInset: number): number => Math.max(84, 50 + Math.max(0, bottomInset));
