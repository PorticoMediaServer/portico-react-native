import React, {useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {BrowseSortCapability, BrowseSortSelection} from '../../../../../packages/client-core/src/browse';
import type {BrowseToolbarModel} from '../../../../../packages/client-core/src/presentation/kit-model';
import {sortDirectionKind} from '../../../../../packages/client-core/src/presentation/browse-toolbar';
import {Focusable, Segmented} from '../../kit/controls';
import {MenuRow, Popover} from '../../kit/overlays';
import {Icon} from '../../kit/Icon';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';

/** Library's real vocabulary and native focus identities. The composition uses
 * the accepted Sort primitives; no capability or display label is invented. */
export function LibrarySortMenu({sorts, value, label, onValueChange, onReshuffle}: {
  sorts: readonly BrowseSortCapability[]; value: BrowseToolbarModel['sort']; label: (sort: BrowseSortCapability) => string;
  onValueChange: (value: BrowseSortSelection) => void; onReshuffle: () => void;
}) {
  const theme = useTheme(), anchor = useRef<View>(null), [open, setOpen] = useState(false), active = sorts.find(sort => sort.id === value.field);
  const direction = (dir: 'asc' | 'desc') => defaultI18n.t('web.filters.direction', {kind: sortDirectionKind(value.field), dir});
  const choose = (choice: BrowseSortCapability) => {
    if (choice.id === value.field && value.reshufflable) onReshuffle();
    else {const flipped = value.direction === 'asc' ? 'desc' : 'asc'; onValueChange({field: choice.id, direction: choice.id === value.field && choice.directions.includes(flipped) ? flipped : choice.defaultDirection});}
    setOpen(false);
  };
  return <>
    <Focusable ref={anchor} focusId="sort" testID="library-sort" accessibilityLabel={defaultI18n.t('next.browse.native.sort')} accessibilityState={{expanded: open}}
      focusKind="chip" focusRadius={theme.isTV ? 14 : 10} onPress={() => setOpen(true)} style={{height: theme.isTV ? 64 : 34, paddingHorizontal: theme.isTV ? 26 : 14,
        borderRadius: theme.isTV ? 14 : 10, backgroundColor: theme.isTV ? alpha(theme.colors.text, .08) : theme.colors.raisedHigh, flexDirection: 'row', alignItems: 'center', gap: 8}}>
      <Icon name="i-sort" size={theme.isTV ? 26 : 18} color={theme.colors.textTertiary}/>
      {active && <><Text style={[browseType(theme, theme.isTV ? 22 : 14.5, 700), {color: theme.colors.text}]}>{label(active)}</Text>
        {value.flippable && !active.seeded && <Text style={[browseType(theme, theme.isTV ? 22 : 14.5), {color: theme.colors.textTertiary}]}>{direction(value.direction)}</Text>}</>}
    </Focusable>
    <Popover open={open} onOpenChange={setOpen} anchorRef={anchor} returnFocusRef={anchor} title={defaultI18n.t('next.browse.native.sort')}
      width={theme.isTV ? 560 : 300} placement="bottom-end">
      <ScrollView style={{maxHeight: theme.isTV ? 680 : 560}}>{sorts.map(choice => <MenuRow key={choice.id} focusId={`sort:${choice.id}`} label={label(choice)}
        description={choice.expensive ? defaultI18n.t('next.browse.native.expensiveSort') : undefined} selected={choice.id === value.field}
        accessibilityRole="radio" accessibilityState={{checked: choice.id === value.field}} variant={theme.isTV ? 'tv' : 'compact'} onPress={() => choose(choice)}/>)}</ScrollView>
      {active && value.flippable && !active.seeded && <View style={{borderTopWidth: 1, borderTopColor: theme.colors.line, padding: 8, gap: 6}}>
        <Text style={[browseType(theme, theme.isTV ? 20 : 13, 700), {color: theme.colors.textTertiary}]}>{defaultI18n.t('next.browse.native.order')}</Text>
        <Segmented variant="browse" value={value.direction} onValueChange={dir => onValueChange({field: value.field, direction: dir as 'asc' | 'desc'})}
          itemProps={item => ({focusId: `order:${item.value}`})} items={active.directions.map(dir => ({value: dir, label: direction(dir)}))}/>
      </View>}
    </Popover>
  </>;
}
