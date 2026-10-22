import {libraryNavigationIcon, sizeClassForWidth, type SizeClass, type Library} from '../../../../packages/client-core/src/index';
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

/** TV glyph semantics come from the same checked canonical presentation mapping. */
export const libraryIcon = (kind: string): IconName => libraryNavigationIcon(kind, 'tv');

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
  const sizeClass = sizeClassForWidth(width);
  return {kind: sizeClass === 'compact' ? 'phone' : sizeClass === 'medium' ? 'tablet' : 'desktop', panel: sizeClass === 'compact' ? 'bottom' : 'side', tabs: sizeClass === 'compact', scale: 1, left: 0, top: 0, width, height};
}

/** tablet-kit.css navigation geometry; collapsing changes chrome, never the page tree. */
export function touchNavigationWidth(sizeClass: SizeClass, collapsed: boolean): number {
  return sizeClass === 'compact' ? 0 : sizeClass === 'medium' || collapsed ? 84 : 248;
}

/** The 84-point drawn bar includes the ordinary bottom safe area. Larger insets extend it. */
export const phoneBarHeight = (bottomInset: number): number => Math.max(84, 50 + Math.max(0, bottomInset));

/** phone-app.html draws54 points over the opening hero and46 after scrolling. */
export function phoneHeaderGeometry(topInset: number, scrolled: boolean): Readonly<{top: number; height: number}> {
  const top = Math.max(scrolled ? 46 : 54, Math.max(0, topInset));
  return {top, height: top + 50};
}
