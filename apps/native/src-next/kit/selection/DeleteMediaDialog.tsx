import React from 'react';
import {StyleSheet, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import {Button} from '../controls/Button';
import {Switch} from '../controls/Switch';
import {TextField} from '../controls/TextField';
import {Icon} from '../Icon';
import {useTheme} from '../theme';
import {selectionText} from './copy';
import {deleteSelectionGate} from './presentation';
import {SelectionSurface, SelectionText} from './surface';
import type {DeleteMediaDialogProps} from './types';

export function DeleteMediaDialog(props: DeleteMediaDialogProps) {
  const {isTV, colors} = useTheme();
  if (isTV || !props.owner) return null;
  const gate = deleteSelectionGate(props);
  const preview = props.preview;
  const result = props.result;
  const title = result ? selectionText('next.selection.native.done') : preview?.confirmationKind === 'title' ? selectionText('next.selection.native.deleteTitle', {title: preview.confirmation}) : selectionText('next.selection.native.deleteTitles', {count: props.selectionCount});
  const restricted = gate === 'limit' || gate === 'libraries' || gate === 'blocked';
  const close = () => props.onOpenChange(false, 'action');
  const totals = new Map<string, number>();
  for (const target of preview?.targets ?? []) for (const dependent of target.dependents) totals.set(dependent.kind, (totals.get(dependent.kind) ?? 0) + dependent.count);
  const dependencies = [...totals].filter(([kind]) => kind !== 'progress').map(([kind, count]) => selectionText(kind === 'playlist' ? 'next.selection.native.dependent.playlist' : kind === 'collection' ? 'next.selection.native.dependent.collection' : kind === 'progress' ? 'next.selection.native.dependent.progress' : kind === 'saved' ? 'next.selection.native.dependent.saved' : kind === 'library-channel' ? 'next.selection.native.dependent.channel' : 'next.selection.native.dependent.recording', {count}));
  const kept = result?.receipts.filter(receipt => !receipt.removed) ?? [];
  const footer = <View style={styles.buttons}>
    <Button size="compact" variant={result ? 'primary' : 'glass'} style={result ? {flex: 1, alignSelf: 'stretch'} : {flex: 1}} onPress={close}>{selectionText(result || restricted ? 'next.selection.native.close' : 'next.selection.native.cancel')}</Button>
    {!result ? <Button size="compact" variant="text" disabled={gate !== null || !!props.error} loading={props.pending} style={{flex: 1, alignSelf: 'stretch', backgroundColor: colors.record}} textStyle={{color: '#2a0808'}} onPress={() => {if (preview && gate === null && !props.error) props.onDelete(preview, props.confirmation, props.removeFiles);}}>{props.selectionCount === 1 || restricted ? selectionText('next.selection.native.delete') : selectionText('next.selection.native.deleteCount', {count: props.selectionCount})}</Button> : null}
  </View>;
  return <SelectionSurface open={props.open} onOpenChange={props.onOpenChange} title={title} headerContext={props.ownerHeader} footer={footer} initialFocusRef={props.initialFocusRef} returnFocusRef={props.returnFocusRef} testID={props.testID}>
    <View style={styles.stack}>
      {result ? <>
        <SelectionText>{selectionText('next.selection.native.deleteResult', {removed: result.removed, failed: result.failed})}</SelectionText>
        {kept.slice(0, 5).map(receipt => <View key={receipt.itemId} style={styles.warning}>
          <Icon name="i-warn" size={18} color={colors.amber} />
          <View style={{flex: 1, gap: 3}}><SelectionText weight={700}>{receipt.title}</SelectionText><SelectionText size={12} secondary>{selectionText(receipt.code === 'file_changed' ? 'next.selection.native.fileChanged' : 'next.selection.native.fileNotRemoved')}</SelectionText></View>
        </View>)}
        {kept.length > 5 ? <SelectionText secondary>{selectionText('next.selection.native.andMore', {count: kept.length - 5})}</SelectionText> : null}
      </> : restricted ? <View style={styles.warning} accessibilityLiveRegion="polite"><Icon name="i-warn" size={18} color={gate === 'limit' ? colors.record : colors.amber} /><SelectionText size={13.5} style={{flex: 1}}>{selectionText(gate === 'limit' ? 'next.selection.native.deleteLimit' : gate === 'libraries' ? 'next.selection.native.deleteLibraries' : 'next.selection.native.deleteBlocked', {library: preview?.targets.find(target => !target.allowMediaDeletion)?.libraryName ?? preview?.blocked[0] ?? ''})}</SelectionText></View>
        : props.loading || !preview ? <SelectionText secondary>{selectionText('next.selection.native.checking')}</SelectionText> : <>
          {preview.targets.some(target => target.titles > 1) ? <>
            <SelectionText weight={700}>{selectionText('next.selection.native.descendants', {count: preview.targets.reduce((sum, target) => sum + target.titles, 0)})}</SelectionText>
            <SelectionText secondary>{selectionText('next.selection.native.everythingBeneath')}</SelectionText>
          </> : null}
          {preview.targets.length > 1 ? <View style={{gap: 8}}>{preview.targets.slice(0, 5).map(target => <View key={target.itemId} style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
            {props.renderArtwork ? <View pointerEvents="none" style={{width: 24, height: 36}}>{props.renderArtwork(target.itemId)}</View> : null}
            <View style={{flex: 1}}><SelectionText size={13.5} weight={700}>{target.title}</SelectionText><SelectionText size={12} secondary>{selectionText('next.selection.native.fileFacts', {count: target.files.length, size: defaultI18n.bytes(target.bytes)})}</SelectionText></View>
          </View>)}{preview.targets.length > 5 ? <SelectionText size={13.5} secondary>{selectionText('next.selection.native.andMore', {count: preview.targets.length - 5})}</SelectionText> : null}</View> : null}
          <SelectionText>{selectionText('next.selection.native.fileFacts', {count: preview.totalFiles, size: preview.totalBytesText})}{dependencies.length ? selectionText('next.selection.native.dependencies', {dependencies: defaultI18n.list(dependencies)}) : ''}{totals.get('progress') ? selectionText('next.selection.native.savedPlaces', {count: totals.get('progress')!}) : ''}</SelectionText>
          <Switch variant="selection" checked={props.removeFiles} onCheckedChange={props.onRemoveFilesChange} disabled={props.pending} description={selectionText(props.removeFiles ? 'next.selection.native.irrecoverable' : 'next.selection.native.filesStay')}>{selectionText('next.selection.native.removeFiles')}</Switch>
          <TextField value={props.confirmation} onChangeText={props.onConfirmationChange} editable={!props.pending}
            label={preview.confirmationKind === 'title' ? selectionText('next.selection.native.typeTitle') : selectionText('next.selection.native.typeCount', {count: preview.confirmation})}
            accessibilityLabel={preview.confirmationKind === 'title' ? selectionText('next.selection.native.typeTitle') : selectionText('next.selection.native.typeCount', {count: preview.confirmation})}
            keyboardType={preview.confirmationKind === 'count' ? 'number-pad' : 'default'} autoCapitalize="none" autoCorrect={false}
            description={preview.confirmationKind === 'title' ? preview.confirmation : undefined} />
        </>}
      {props.error ? <SelectionText style={{color: colors.danger}}>{props.error}</SelectionText> : null}
      {gate === 'limit' ? <SelectionText size={12} secondary>{selectionText('next.selection.native.neverSplit')}</SelectionText> : null}
    </View>
  </SelectionSurface>;
}
const styles = StyleSheet.create({buttons: {flexDirection: 'row', gap: 10}, stack: {gap: 14, paddingTop: 12}, warning: {padding: 12, borderRadius: 10, flexDirection: 'row', gap: 10, backgroundColor: 'rgba(232,188,106,.1)', borderWidth: 1, borderColor: 'rgba(232,188,106,.35)'}});
