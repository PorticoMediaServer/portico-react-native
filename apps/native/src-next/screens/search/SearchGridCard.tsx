import React, {useRef} from 'react';
import {View} from 'react-native';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {SearchEntry, SearchGroup} from '../../../../../packages/client-core/src/search';
import {PosterCard, SquareCard, CircleCard, EpisodeTile, type CardSelection} from '../../kit/cards';
import type {NativeShellRuntime} from '../../shell/runtime';
import {homeCardText} from '../home/model';
import {nativeSearchEntryKey} from './model';
import type {NativeSearchActions} from './types';
const media = (entry: SearchEntry): entry is ContentEntry => entry.kind !== 'person' && entry.kind !== 'channel';

export function SearchGridCard({entry, group, runtime, actions, selection, width, disabled, onFocus, onBlur}: {entry: SearchEntry; group: SearchGroup; runtime: NativeShellRuntime; actions: NativeSearchActions; selection?: CardSelection; width: number; disabled?: boolean; onFocus?: () => void; onBlur?: () => void}) {
  const menuAnchorRef = useRef<View>(null), content = media(entry) ? entry : undefined;
  const text = content ? homeCardText(content, false, runtime.text) : undefined;
  const props = {testID: `search-result-${nativeSearchEntryKey(group, entry)}`, focusId: nativeSearchEntryKey(group, entry), disabled, onFocus, onBlur, density: 'grid' as const, title: content?.displayTitle || entry.title, width, caption: text?.caption,
    onNavigate: () => actions.open(entry, group), onMore: actions.canMenu?.(entry, group) === false ? undefined : () => actions.menu(entry, group, menuAnchorRef), selection, menuAnchorRef, moreExpanded: actions.isMenuOpen?.(entry, group)};
  if (group === 'movies' || group === 'shows') return <PosterCard {...props} artwork={runtime.artwork(entry.posterUrl)}/>;
  if (group === 'episodes') return <EpisodeTile {...props} label={text?.caption ?? []} layout="tile" artwork={runtime.artwork(content?.stillUrl ?? content?.backdropUrl ?? entry.posterUrl)}/>;
  if (group === 'people') return <CircleCard {...props} person art={{source: runtime.artwork(entry.posterUrl), initials: entry.title.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('')}}/>;
  if (group === 'artists') return <CircleCard {...props} art={{covers: content?.artworkPaths?.flatMap(path => {const source = runtime.artwork(path); return source ? [source] : [];}) ?? []}}/>;
  return <SquareCard {...props} artwork={runtime.artwork(entry.posterUrl)}/>;
}

