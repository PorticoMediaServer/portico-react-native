import React, {useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../packages/i18n/src';
import type {HomeSelectionController} from '../../../../packages/client-core/src/home-selection/index';
import type {SelectionActionReason} from '../../../../packages/client-core/src/selection-model/index';
import {SelectionBar, SelectionPhoneActionBar, type SelectionBarProps} from '../kit/selection';
import {useTheme} from '../kit/theme';
import {nativeSelectionCommand, nativeSelectionOffers} from './selection-actions';

const t = defaultI18n.t;
const reason = (value: SelectionActionReason): string => t(value === 'mixed-types' ? 'next.selection.native.mixedTitle'
  : value === 'no-bulk-fields' ? 'next.selection.native.noBulkFields'
    : value === 'one-library-required' ? 'next.selection.native.deleteLibraries'
      : value === 'delete-limit' ? 'next.selection.native.deleteLimit' : 'error.permission');

/** Controlled native presentation for the one shared HomeSelectionController/SelectionModel. */
export function HomeSelectionBars({controller, ownerTag, reportError}: {
  controller: HomeSelectionController; ownerTag?: React.ReactNode; reportError: (error: unknown) => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const theme = useTheme(), insets = useSafeAreaInsets();
  const [menu, setMenu] = useState<SelectionBarProps['menu']>(null);
  if (!snapshot.selection.active) return null;
  const props: SelectionBarProps = {count: snapshot.selection.summary.count, selectAllLabel: t('next.home.native.selectRow'),
    onSelectAll: () => controller.selectRow(), onCancel: () => {setMenu(null); controller.clear();},
    onAction: action => {const command = nativeSelectionCommand(action); if (command) {setMenu(null); void controller.execute(command).catch(reportError);}},
    actions: nativeSelectionOffers(snapshot.actions, reason), menu, onMenuChange: setMenu, ownerTag,
    topInset: insets.top};
  return <View pointerEvents="box-none" style={{position: 'absolute', inset: 0, zIndex: theme.layers.navigation + 1}}>
    <View style={theme.isTV ? {position: 'absolute', left: 200, right: 96, top: 58} : {position: 'absolute', left: 0, right: 0, top: 0}}><SelectionBar {...props}/></View>
    {!theme.isTV && <View style={{position: 'absolute', left: 0, right: 0, bottom: 0}}><SelectionPhoneActionBar actions={props.actions} onAction={props.onAction} onMenuChange={setMenu} bottomInset={Math.max(34, insets.bottom)}/></View>}
  </View>;
}
