import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Button, Focusable} from '../../kit/controls';
import {BottomSheet, SidePanel, type FocusRef} from '../../kit/overlays';
import {nativeType, useTheme} from '../../kit/theme';
import type {NativeVersionDestination} from './factory';

export type NativeVersionChooserProps = Readonly<{
  destination: NativeVersionDestination;
  onDismiss: () => void;
  reportError: (error: unknown) => void;
  returnFocusRef?: FocusRef;
}>;

/** Published6212 phone9b/TV8b: immediate action rows, one overlay focus owner,
 * actual subject, and canonical two-line facts. No version choice is saved. */
export function NativeVersionChooser({destination, onDismiss, reportError, returnFocusRef}: NativeVersionChooserProps) {
  const theme = useTheme(), first = useRef<View>(null), pending = useRef(false);
  const [starting, setStarting] = useState(false);
  const current = useSyncExternalStore(destination.subscribe, destination.isCurrent);
  useEffect(() => {if (!current) onDismiss();}, [current, onDismiss]);
  const focusId = destination.rows.find(row => row.id === destination.selectedVersionId)?.id ?? destination.rows[0]?.id;
  const choose = async (id: string) => {
    if (pending.current || !destination.isCurrent()) return;
    pending.current = true; setStarting(true);
    try {if (await destination.choose(id)) onDismiss();}
    catch (error) {if (destination.isCurrent()) reportError(error);}
    finally {pending.current = false; setStarting(false);}
  };
  const primary = nativeType({size: theme.isTV ? 22 : 15.5, weight: theme.isTV ? 600 : 700, tracking: theme.isTV ? 0 : -.01, lineHeight: 'normal'}, theme.textScale);
  const secondary = nativeType({size: theme.isTV ? 19 : 13, weight: 500, tracking: 0, lineHeight: theme.isTV ? 'normal' : 18.2}, theme.textScale);
  const rows = destination.rows.map((row, index) => <Focusable key={row.id} ref={row.id === focusId ? first : undefined} testID={`watch-version-${row.id}`} focusId={`watch-version-${row.id}`}
    focusKind="row" focusRadius={theme.isTV ? 12 : 0} accessibilityRole="button" accessibilityState={{selected: row.id === destination.selectedVersionId, busy: starting}} disabled={!current || starting}
    onPress={() => {void choose(row.id);}} style={({focused}) => ({minHeight: theme.isTV ? 54 : 64, paddingHorizontal: theme.isTV ? 14 : 16, paddingVertical: theme.isTV ? 14 : 10,
      marginBottom: theme.isTV ? 14 : 0, borderRadius: theme.isTV ? 12 : 0, justifyContent: 'center', backgroundColor: theme.isTV && focused ? '#edf5fa29' : 'transparent'})}>
    {({focused}) => <>
      {!theme.isTV && index > 0 && <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 16, right: 0, height: 1, backgroundColor: '#3b566873'}}/>}
      <Text style={[primary, {color: theme.isTV && !focused ? theme.colors.textSecondary : theme.colors.text}]}>{row.primary}</Text>
      <Text style={[secondary, {marginTop: theme.isTV ? 2 : 3, color: theme.isTV && !focused ? theme.colors.textTertiary : theme.colors.textSecondary}]}>{row.secondary}</Text>
    </>}
  </Focusable>);
  const shell = {open: current, onOpenChange: (open: boolean) => {if (!open) onDismiss();}, title: destination.title,
    initialFocusRef: first, returnFocusRef, testID: 'watch-version-chooser'};
  if (theme.isTV) return <SidePanel {...shell} width={760} topInset={0} showClose={false} description={destination.subject}
    titleType={{size: 44, weight: 800, tracking: -.03, lineHeight: 'normal'}}
    descriptionTextStyle={[nativeType({size: 22, weight: 700, tracking: 0, lineHeight: 31.9}, theme.textScale), {color: theme.colors.text, marginTop: 10}]}
    style={{paddingTop: 42}} footer={<VersionHint/>}>
    <ScrollView style={{marginHorizontal: -24}} contentContainerStyle={{paddingHorizontal: 24, paddingTop: 12, paddingBottom: 72}}>{rows}</ScrollView>
  </SidePanel>;
  const header = <View style={{paddingHorizontal: 20, paddingTop: 2, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-start'}}>
    <View style={{flex: 1}}><Text accessibilityRole="header" style={[nativeType({size: 21, weight: 800, tracking: -.02, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{destination.title}</Text>
      <Text style={[nativeType({size: 14, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary, marginTop: 3}]}>{destination.subject}</Text></View>
    <Button variant="text" size="small" onPress={onDismiss} style={{height: 24, paddingHorizontal: 0, marginTop: 2}}
      textStyle={[nativeType({size: 15, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textSecondary}]}>{defaultI18n.t('action.done')}</Button>
  </View>;
  return <BottomSheet {...shell} fitContent headerContent={header}>
    <View style={{marginHorizontal: 16, borderRadius: 14, backgroundColor: theme.colors.raisedHigh, overflow: 'hidden'}}>{rows}</View>
  </BottomSheet>;
}
function VersionHint() {
  const theme = useTheme(), t = defaultI18n.t;
  const key = (label: string) => <View style={{minWidth: 44, height: 36, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, borderColor: '#edf5fa4d', alignItems: 'center', justifyContent: 'center'}}>
    <Text style={[nativeType({size: 17, weight: 800, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textSecondary}]}>{label}</Text></View>;
  const label = (value: string) => <Text style={[nativeType({size: 20, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary}]}>{value}</Text>;
  return <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>{key(t('title.ok'))}{label(t('action.play'))}<View style={{width: 16}}/><View style={{width: 16}}/>{key(t('action.back'))}{label(t('action.close'))}</View>;
}
