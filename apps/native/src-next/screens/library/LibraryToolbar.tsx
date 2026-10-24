import React, {type RefObject} from 'react';
import {ScrollView, View, useWindowDimensions} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {BrowseSortSelection} from '../../../../../packages/client-core/src/browse';
import type {BrowseToolbarModel} from '../../../../../packages/client-core/src/presentation/kit-model';
import {Button, Chip} from '../../kit/controls';
import {FocusItem} from '../../kit/focus';
import {FiltersButton, QuickToggle, SaveViewButton, type BrowseLabels} from '../../kit/browse';
import {useTheme} from '../../kit/theme';
import {LibrarySortMenu} from './LibrarySortMenu';

/** Phone4/tablet3–4 and tv4 keep their drawn control order. Selection is an
 * actual caller action; an absent execution port never creates a dummy button. */
export function LibraryToolbar({model, labels, filterCount, filtersOpen, onFilters, onSort, onReshuffle, onQuick, onSave,
  onJump, jumpEnabled, jumpAnchor, onSelect, selecting, canSave}: {
  model: BrowseToolbarModel; labels: BrowseLabels; filterCount: number; filtersOpen: boolean;
  onFilters: () => void; onSort: (sort: BrowseSortSelection) => void; onReshuffle: () => void;
  onQuick: (id: string, enabled: boolean) => void; onSave: () => void;
  canSave: boolean;
  onJump: () => void; jumpEnabled: boolean; jumpAnchor: RefObject<View | null>;
  onSelect?: () => void; selecting: boolean;
}) {
  const theme = useTheme(), {width} = useWindowDimensions();
  const sort = <LibrarySortMenu sorts={model.sorts} value={model.sort} label={labels.sort} onValueChange={onSort} onReshuffle={onReshuffle}/>;
  const filters = <FocusItem focusId="filters"><FiltersButton count={filterCount} open={filtersOpen} onPress={onFilters}/></FocusItem>;
  const controls = <>
    {theme.isTV ? <>{sort}{filters}<Chip ref={jumpAnchor} focusId="jump" disabled={!jumpEnabled} onPress={onJump}>{defaultI18n.t('next.browse.native.jumpTo')}</Chip></>
      : <>{width >= 600 && onSelect && !selecting && <FocusItem focusId="select"><Button testID="library-select" variant="glass" size="small" onPress={onSelect} style={{height: 44}}>{defaultI18n.t('next.selection.select')}</Button></FocusItem>}{filters}{sort}</>}
    {theme.isTV && <View style={{width: 1.5, height: 40, backgroundColor: theme.colors.line, marginHorizontal: 6}}/>}
    {model.quick.map(preset => <FocusItem key={preset.id} focusId={`quick:${preset.id}`}><QuickToggle checked={preset.active} onCheckedChange={enabled => onQuick(preset.id, enabled)}>{preset.label?.text ?? labels.quick(preset)}</QuickToggle></FocusItem>)}
    {theme.isTV && <View style={{marginLeft: 'auto'}}><FocusItem focusId="save"><SaveViewButton canSave={canSave} onSave={onSave}/></FocusItem></View>}
  </>;
  return theme.isTV ? <View style={{paddingHorizontal: theme.gutter, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 14}}>{controls}</View>
    : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal: theme.gutter, paddingTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8}}>{controls}</ScrollView>;
}
