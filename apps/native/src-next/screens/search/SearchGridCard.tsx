import React, {useRef} from 'react';
import {View} from 'react-native';
import {useFocusWaiting} from '../../kit/focus';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {SearchEntry, SearchGroup} from '../../../../../packages/client-core/src/search';
import {PosterCard, SquareCard, CircleCard, EpisodeTile, type CardSelection} from '../../kit/cards';
import type {NativeShellRuntime} from '../../shell/runtime';
import {homeCardText} from '../home/model';
import {nativeSearchEntryKey} from './model';
import type {NativeSearchActions} from './types';
const media = (entry: SearchEntry): entry is ContentEntry => entry.kind !== 'person' && entry.kind !== 'channel';

export function SearchGridCard({entry, group, runtime, actions, selection, width, disabled, onFocus, onBlur, focusId, testID}: {entry?: SearchEntry; focusId?: string; testID?: string; group: SearchGroup; runtime: NativeShellRuntime; actions: NativeSearchActions; selection?: CardSelection; width: number; disabled?: boolean; onFocus?: () => void; onBlur?: () => void}) {
  const waiting = useFocusWaiting();
  const menuAnchorRef = useRef<View>(null), content = entry && media(entry) ? entry : undefined;
  if (!entry && !waiting) throw new Error('A search card requires a served entry or an owned waiting slot.');
  const text = content ? homeCardText(content, false, runtime.text) : undefined;
  const props = {testID: testID ?? (entry ? `search-result-${nativeSearchEntryKey(group, entry)}` : undefined), focusId: focusId ?? (entry ? nativeSearchEntryKey(group, entry) : undefined), disabled, onFocus, onBlur, density: 'grid' as const, title: content?.displayTitle || entry?.title || '', width, caption: text?.caption,
    onNavigate: () => {if (entry) actions.open(entry, group);}, onMore: !entry || actions.canMenu?.(entry, group) === false ? undefined : () => actions.menu(entry, group, menuAnchorRef), selection, menuAnchorRef, moreExpanded: entry ? actions.isMenuOpen?.(entry, group) : undefined};
  if (group === 'movies' || group === 'shows') return <PosterCard {...props} artwork={runtime.artwork(entry?.posterUrl)}/>;
  if (group === 'episodes') return <EpisodeTile {...props} label={text?.caption ?? []} layout="tile" artwork={runtime.artwork(content?.stillUrl ?? content?.backdropUrl ?? entry?.posterUrl)}/>;
  if (group === 'people') return <CircleCard {...props} person art={{source: runtime.artwork(entry?.posterUrl), initials: (entry?.title ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('')}}/>;
  if (group === 'artists') return <CircleCard {...props} art={{covers: content?.artworkPaths?.flatMap(path => {const source = runtime.artwork(path); return source ? [source] : [];}) ?? []}}/>;
  return <SquareCard {...props} artwork={runtime.artwork(entry?.posterUrl)}/>;
}

