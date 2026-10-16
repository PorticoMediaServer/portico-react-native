import React from 'react';
import {View} from 'react-native';
import {playlistListFilters, type PlaylistListFilter} from '../../../../packages/client-core/src/saved';
import {Button, Text, useTheme} from '../ui';
import {useI18n} from '../app/i18n';

type Sort = Readonly<{id: string; labelKey: string}>;
type Filter = Readonly<{id: string; options: readonly Readonly<{id: string; count: number}>[]}>;

/** A playlist sort's name, from the server's label key (`playlists.sort.<id>`). */
export const playlistSortLabel = (i18n: ReturnType<typeof useI18n>, labelKey: string): string => i18n.t('playlists.sort', {field: labelKey.replace(/^playlists\.sort\./, '')});

/**
 * The list of playlists' own Sort (name, date created, last changed, number of items) and its
 * groups (all, mine, shared with me, pinned, with their counts), as plain focusable buttons, for
 * Saved's Playlists tab and a music library's Playlists tab alike.
 */
export function PlaylistControls({sorts, filters, sort, direction, filter, onSort, onFilter}: {sorts: readonly Sort[]; filters: readonly Filter[]; sort?: string; direction?: 'asc' | 'desc'; filter?: PlaylistListFilter; onSort: (sort: string, direction: 'asc' | 'desc') => void; onFilter: (filter: PlaylistListFilter | undefined) => void}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const options = filters.find(f => f.id === 'filter')?.options.filter(o => (playlistListFilters as readonly string[]).includes(o.id)) ?? [];
  const current = filter ?? 'all';
  if (!sorts.length && options.length < 2) return null;
  return (
    <View style={{gap: space.sm, paddingHorizontal: space.page, paddingVertical: space.md}}>
      {sorts.length ? (
        <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm}}>
          <Text variant="label" tone="tertiary" style={{marginRight: space.xs}}>{i18n.t('saved.sort')}</Text>
          {sorts.map(s => {
            const active = (sort ?? sorts[0]?.id) === s.id;
            return <Button key={s.id} size="sm" variant="secondary" selected={active} label={playlistSortLabel(i18n, s.labelKey)} trailingIcon={active ? (direction === 'desc' ? 'chevronDown' : 'chevronUp') : undefined} onPress={() => onSort(s.id, active ? (direction === 'desc' ? 'asc' : 'desc') : s.id === 'title' ? 'asc' : 'desc')} />;
          })}
        </View>
      ) : null}
      {options.length >= 2 ? (
        <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm}}>
          <Text variant="label" tone="tertiary" style={{marginRight: space.xs}}>{i18n.t('playlists.filter')}</Text>
          {options.map(o => <Button key={o.id} size="sm" variant="secondary" selected={o.id === current} label={`${i18n.t('playlists.filter.option', {group: o.id})} (${i18n.number(o.count)})`} onPress={() => onFilter(o.id === 'all' ? undefined : o.id as PlaylistListFilter)} />)}
        </View>
      ) : null}
    </View>
  );
}
