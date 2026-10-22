import React from 'react';
import {StyleSheet, View} from 'react-native';
import {Button} from '../controls/Button';
import {Focusable} from '../controls/Focusable';
import {Icon} from '../Icon';
import {useTheme} from '../theme';
import {selectionText} from './copy';
import {SelectionSurface, SelectionText} from './surface';
import type {MixedEditExplainerProps} from './types';

export function MixedEditExplainer(props: MixedEditExplainerProps) {
  const {isTV} = useTheme();
  if (isTV) return null;
  return <SelectionSurface {...props} title={selectionText('next.selection.native.mixedTitle')} description={props.description}
    footer={<Button variant="glass" size="compact" style={{alignSelf: 'stretch'}} onPress={() => props.onOpenChange(false, 'action')}>{selectionText('next.selection.native.close')}</Button>}>
    <SelectionText size={12.5} weight={700} secondary style={{marginVertical: 16}}>{selectionText('next.selection.native.keepOnly')}</SelectionText>
    {props.groups.map(group => <Focusable key={group.kind} accessibilityRole="button" accessibilityLabel={group.label}
      onPress={() => {props.onKeepOnly(group.kind); props.onOpenChange(false, 'action');}} focusKind="row" focusRadius={10} style={styles.row}>
      <Icon name={group.icon} size={24} />
      <View style={{gap: 3}}><SelectionText size={16} weight={600}>{group.label}</SelectionText><SelectionText size={12.5} secondary>{selectionText('next.selection.native.ofCount', {count: group.count, total: props.total})}</SelectionText></View>
    </Focusable>)}
  </SelectionSurface>;
}
const styles = StyleSheet.create({row: {minHeight: 56, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 14}});
