import React, {useRef} from 'react';
import {FlatList, StyleSheet, TextInput, View} from 'react-native';
import {Button} from '../controls/Button';
import {Focusable} from '../controls/Focusable';
import {TextField} from '../controls/TextField';
import {Icon} from '../Icon';
import {ToastHost} from '../overlays/Feedback';
import {useTheme} from '../theme';
import {selectionText} from './copy';
import {failedSelectionIds} from './presentation';
import {SelectionSurface, SelectionText} from './surface';
import type {PickerEntry, PickerProps} from './types';

export type DestinationPickerProps = PickerProps & {onViewDestination: (id: string) => void; onResultDismiss: () => void};
function DestinationPicker({kind, ...props}: DestinationPickerProps & {kind: 'playlist' | 'collection'}) {
  const {isTV, colors} = useTheme();
  const nameRef = useRef<TextInput>(null);
  const retryRef = useRef<View>(null);
  const entryRef = useRef<View>(null);
  const preferredId = props.focusedEntryId ?? props.entries[0]?.id;
  const failed = props.result ? failedSelectionIds(props.result.outcomes) : [];
  const added = props.result?.outcomes.filter(row => row.ok).length ?? 0;
  const complete = !!props.result && props.result.outcomes.length > 0 && !failed.length;
  const newLabel = selectionText(`next.selection.native.new.${kind}`);
  const retry = () => {if (!props.pending && failed.length) props.onRetry(failed);};
  const close = () => props.onOpenChange(false, 'action');
  const title = props.creating ? newLabel : selectionText(`next.selection.native.picker.${kind}`);
  const row = (item: PickerEntry) => <Focusable ref={item.id === preferredId ? entryRef : undefined} hasTVPreferredFocus={isTV && !failed.length && item.id === preferredId} accessibilityRole="button" accessibilityLabel={item.title} focusRadius={isTV ? 16 : 10} focusKind="row"
    disabled={props.pending} onPress={() => props.onAdd(item.id)} style={styles.entry}>
    {state => <View style={[styles.entryContent, {minHeight: isTV ? 104 : 64, paddingHorizontal: isTV ? 16 : 20, gap: isTV ? 24 : 14, borderRadius: isTV ? 16 : 10, backgroundColor: isTV ? state.focused ? colors.text : 'rgba(237,245,250,.07)' : 'transparent'}]}>
      <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{width: isTV ? 76 : 48, height: isTV ? 76 : 48, overflow: 'hidden', borderRadius: isTV ? 12 : 10}}>{item.artwork}</View>
      <View style={{flex: 1, minWidth: 0}}>
        <SelectionText numberOfLines={1} size={isTV ? 28 : 16} weight={700} style={{color: isTV && state.focused ? colors.ink : colors.text}}>{item.title}</SelectionText>
        <SelectionText size={isTV ? 20 : 12.5} secondary style={{marginTop: 3, color: isTV && state.focused ? 'rgba(7,16,24,.66)' : colors.textTertiary}}>{selectionText('next.selection.native.titles', {count: item.size})}</SelectionText>
      </View>
      {item.alreadyIn > 0 ? <SelectionText size={isTV ? 20 : 12.5} weight={700} style={{color: isTV && state.focused ? 'rgba(7,16,24,.66)' : colors.accentStrong}}>{selectionText('next.selection.native.alreadyIn', {count: item.alreadyIn})}</SelectionText> : null}
    </View>}
  </Focusable>;
  const buttons = <View style={styles.buttons}>
    <Button size="compact" variant="glass" onPress={props.creating ? () => props.onCreatingChange(false) : close}>{selectionText(props.creating ? 'next.selection.native.cancel' : 'next.selection.native.done')}</Button>
    {props.creating ? <Button size="compact" loading={props.pending} style={{flex: 1, alignSelf: 'stretch'}} onPress={() => props.onCreateAndAdd(props.name.trim() || newLabel)}>{selectionText('next.selection.native.createAdd', {count: props.count})}</Button>
      : failed.length ? <Button ref={retryRef} size="compact" loading={props.pending} style={{flex: 1, alignSelf: 'stretch'}} onPress={retry}>{failed.length === 1 ? selectionText('next.selection.native.retryFor', {title: props.result!.outcomes.find(item => !item.ok)!.title}) : selectionText('next.selection.native.retry')}</Button> : null}
  </View>;
  return <>
    <SelectionSurface scrollable={false} open={props.open} onOpenChange={props.onOpenChange} title={title} description={props.selectionLabel}
      initialFocusRef={failed.length ? retryRef : props.creating ? props.initialFocusRef ?? nameRef : props.initialFocusRef ?? entryRef} returnFocusRef={props.returnFocusRef}
      testID={props.testID} footer={props.creating || props.result ? buttons : undefined} contentStyle={{paddingHorizontal: 0}}>
      {props.error ? <View style={styles.notice}><SelectionText>{props.error}</SelectionText></View> : null}
      {props.result && failed.length ? <View style={styles.notice} accessibilityLiveRegion="polite">
        <SelectionText size={isTV ? 24 : 14.5} weight={700}>{selectionText('next.selection.native.addedPartial', {added, count: props.result.outcomes.length, title: props.result.destination.title})}</SelectionText>
        {props.result.outcomes.filter(item => !item.ok).map(item => <SelectionText key={item.id} size={isTV ? 22 : 13.5} secondary>{selectionText('next.selection.native.couldNotAdd', {title: item.title, reason: item.reason ?? selectionText('next.selection.native.addFailed')})}</SelectionText>)}
      </View> : null}
      {props.creating ? <View style={{paddingHorizontal: 20, paddingBottom: 8}}>{props.nameInput ?? <TextField ref={nameRef} autoFocus={!isTV} value={props.name} onChangeText={props.onNameChange} label={selectionText('next.selection.native.name')} accessibilityLabel={selectionText('next.selection.native.name')} placeholder={newLabel} editable={!props.pending} returnKeyType="done" onSubmitEditing={() => {if (!props.pending) props.onCreateAndAdd(props.name.trim() || newLabel);}} />}</View> : props.result ? row(props.result.destination) : <>
        {props.showFind ? <View style={{paddingHorizontal: 20, paddingBottom: 6}}><TextField variant="search" value={props.query} onChangeText={props.onQueryChange} accessibilityLabel={selectionText(`next.selection.native.find.${kind}`)} placeholder={selectionText(`next.selection.native.find.${kind}`)} /></View> : null}
        <Focusable accessibilityRole="button" accessibilityLabel={newLabel} disabled={props.pending} onPress={() => props.onCreatingChange(true)} focusRadius={isTV ? 16 : 10} style={{paddingHorizontal: isTV ? 16 : 20, minHeight: isTV ? 104 : 64, flexDirection: 'row', alignItems: 'center', gap: isTV ? 24 : 14}}>
          <View style={{width: isTV ? 76 : 48, height: isTV ? 76 : 48, borderRadius: isTV ? 12 : 10, backgroundColor: 'rgba(237,245,250,.1)', alignItems: 'center', justifyContent: 'center'}}><Icon name="i-plus" size={isTV ? 36 : 24} /></View><SelectionText size={isTV ? 28 : 16} weight={700}>{newLabel}</SelectionText>
        </Focusable>
        <FlatList data={props.entries} keyExtractor={item => item.id} renderItem={({item}) => row(item)} scrollEnabled nestedScrollEnabled
          initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} keyboardShouldPersistTaps="handled" onEndReached={() => {if (props.hasMore && !props.loading) props.onLoadMore();}}
          style={{height: Math.min(props.entries.length * (isTV ? 116 : 64), isTV ? 580 : 320)}}
          ItemSeparatorComponent={isTV ? () => <View style={{height: 12}} /> : undefined}
          ListFooterComponent={props.loading ? <SelectionText secondary>{selectionText('next.selection.native.loading')}</SelectionText> : props.entries.length === 0 ? <SelectionText secondary>{selectionText(`next.selection.native.empty.${kind}`)}</SelectionText> : null} />
      </>}
    </SelectionSurface>
    {complete ? <ToastHost bottomOffset={84} toast={{id: `${kind}-${props.result!.destination.id}`, icon: 'i-check', message: selectionText('next.selection.native.added', {count: added, title: props.result!.destination.title}), action: {label: selectionText('next.selection.native.view'), onPress: () => props.onViewDestination(props.result!.destination.id)}}} onDismiss={props.onResultDismiss} /> : null}
  </>;
}
export function PlaylistPicker(props: DestinationPickerProps) {return <DestinationPicker {...props} kind="playlist" />;}
export function CollectionPicker(props: DestinationPickerProps) {return <DestinationPicker {...props} kind="collection" />;}
const styles = StyleSheet.create({entry: {alignSelf: 'stretch'}, entryContent: {flexDirection: 'row', alignItems: 'center', paddingVertical: 8}, buttons: {flexDirection: 'row', gap: 10}, notice: {marginHorizontal: 16, marginBottom: 10, padding: 14, gap: 6, borderRadius: 12, backgroundColor: 'rgba(241,121,121,.08)', borderWidth: 1, borderColor: 'rgba(241,121,121,.35)'}});
