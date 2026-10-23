import React, {useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button} from '../controls/Button';
import {Focusable} from '../controls/Focusable';
import {Icon} from '../Icon';
import {useTheme} from '../theme';
import {selectionText} from './copy';
import {selectionControlID as controlID} from './focus-ids';
import {SelectionSurface, SelectionText} from './surface';
import type {MixedEditExplainerProps} from './types';

export function MixedEditExplainer(props: MixedEditExplainerProps) {
  const {isTV} = useTheme();
  const firstRef = useRef<View>(null);
  const closeRef = useRef<View>(null);
  const mixed = props.groups.length > 1;
  return <SelectionSurface {...props} title={selectionText(mixed ? 'next.selection.native.mixedTitle' : 'next.selection.native.noBulkFields')} description={props.description}
    contentStyle={{paddingHorizontal: isTV ? 0 : 20}} initialFocusRef={props.initialFocusRef ?? (mixed ? firstRef : closeRef)}
    footer={<Button testID={controlID(props.testID, 'dismiss')} ref={closeRef} variant="glass" size="compact" style={{alignSelf: 'stretch'}} onPress={() => props.onOpenChange(false, 'action')}>{selectionText('next.selection.native.close')}</Button>}>
    {mixed ? <SelectionText size={isTV ? 20 : 12.5} weight={700} secondary style={{marginTop: isTV ? 22 : 4, marginBottom: isTV ? 22 : 8}}>{selectionText('next.selection.native.keepOnly')}</SelectionText> : null}
    {mixed ? props.groups.map((group, index) => <Focusable key={group.kind} testID={controlID(props.testID, 'keep-only', group.kind)} ref={index === 0 ? firstRef : undefined} accessibilityRole="button" accessibilityLabel={group.label}
      onPress={() => {props.onKeepOnly(group.kind); props.onOpenChange(false, 'action');}} focusKind="row" focusRadius={isTV ? 14 : 10} style={[styles.row, isTV ? {minHeight: 64, paddingHorizontal: 20, gap: 16, marginBottom: 12} : undefined]}>
      <Icon name={group.icon} size={isTV ? 30 : 24} />
      <View style={{flex: 1, gap: 2}}><SelectionText size={isTV ? 24 : 16} weight={600}>{group.label}</SelectionText><SelectionText size={isTV ? 20 : 12.5} secondary>{selectionText('next.selection.native.ofCount', {count: group.count, total: props.total})}</SelectionText></View>
    </Focusable>) : null}
  </SelectionSurface>;
}
const styles = StyleSheet.create({row: {minHeight: 56, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 14}});
