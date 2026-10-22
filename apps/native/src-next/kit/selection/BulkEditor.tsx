import React, {useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import type {RepairFieldSpec} from '../../../../../packages/client-core/src/metadata-repair';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import {validBulkListEntry} from '../../../../../packages/client-core/src/metadata-bulk';
import {Button} from '../controls/Button';
import {Focusable} from '../controls/Focusable';
import {TextField} from '../controls/TextField';
import {Select} from '../controls/Select';
import {Switch} from '../controls/Switch';
import {Icon} from '../Icon';
import {useTheme} from '../theme';
import {selectionText} from './copy';
import {changeList, changeScalar, failedSelectionIds, removeFieldChange, setListChange} from './presentation';
import {SelectionSurface, SelectionText} from './surface';
import type {BulkEditorProps} from './types';

function ListField({field, ...props}: BulkEditorProps & {field: RepairFieldSpec}) {
  const {colors} = useTheme();
  const [draft, setDraft] = useState('');
  const change = props.changes[field.field];
  const list = change && 'add' in change ? change : {add: [], remove: []};
  const existing = props.values[field.field]?.entries ?? [];
  const values = [...existing.map(entry => ({...entry, added: false})), ...list.add.filter(value => !existing.some(entry => entry.value === value)).map(value => ({value, count: props.count, added: true}))];
  const add = () => {const value = draft.trim(); if (validBulkListEntry(value) && !props.pending) {props.onChangesChange(changeList(props.changes, field.field, value, 'add')); setDraft('');}};
  return <View style={{gap: 6}}>
    <View style={styles.chips}>
      {values.map(entry => {const removed = list.remove.includes(entry.value); const added = list.add.includes(entry.value);return <Focusable key={entry.value} accessibilityRole="button" accessibilityLabel={selectionText(removed ? 'next.selection.native.restoreValue' : 'next.selection.native.removeValue', {value: entry.value})} disabled={props.pending}
        focusRadius={15} onPress={() => {
          if (entry.added) props.onChangesChange(setListChange(props.changes, field.field, list.add.filter(value => value !== entry.value), list.remove));
          else if (removed) props.onChangesChange(setListChange(props.changes, field.field, list.add, list.remove.filter(value => value !== entry.value)));
          else props.onChangesChange(changeList(props.changes, field.field, entry.value, 'remove'));
        }} style={{height: 28, borderRadius: 15, paddingLeft: 12, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderStyle: entry.count < props.count && !added ? 'dashed' : 'solid', borderColor: removed ? 'rgba(241,121,121,.45)' : added ? 'rgba(92,179,226,.7)' : colors.line,
          backgroundColor: removed || entry.count < props.count && !added ? 'transparent' : added ? 'rgba(64,159,212,.24)' : colors.raisedBright}}>
        <SelectionText size={12.5} weight={700} style={{textDecorationLine: removed ? 'line-through' : 'none', color: removed ? colors.textTertiary : colors.text}}>{entry.value}</SelectionText>
        <SelectionText size={12} secondary>{added ? selectionText('next.selection.native.new') : entry.count}</SelectionText><Icon name={removed ? 'i-undo' : 'i-x'} size={12} color={colors.textTertiary} />
      </Focusable>;})}
      <View style={{minWidth: 100, flex: 1}}><TextField accessibilityLabel={selectionText('next.selection.native.addFieldValue', {field: props.fieldLabel(field)})} value={draft} onChangeText={setDraft} onSubmitEditing={add} editable={!props.pending} placeholder={selectionText('next.selection.native.addFieldValue', {field: props.fieldLabel(field)})} maxLength={field.maxLength} returnKeyType="done" fieldStyle={{height: 28, minHeight: 28, borderWidth: 0, paddingHorizontal: 4, backgroundColor: 'transparent'}} style={{fontSize: 12.5}} /></View>
      {draft.trim() ? <Button variant="text" size="small" disabled={!validBulkListEntry(draft.trim()) || props.pending} onPress={add}>{selectionText('next.selection.native.add')}</Button> : null}
    </View>
  </View>;
}
function ScalarField({field, ...props}: BulkEditorProps & {field: RepairFieldSpec}) {
  const {colors} = useTheme();
  const [focused, setFocused] = useState(false);
  const current = props.values[field.field];
  const change = props.changes[field.field];
  const changed = change !== undefined && 'value' in change;
  const value = changed ? change.value : current?.state === 'shared' ? current.value ?? '' : '';
  const hint = changed ? current?.state === 'mixed' ? selectionText('next.selection.native.wasMixed') : '' : current?.state === 'shared' && current.value !== undefined ? selectionText('next.selection.native.all', {count: props.count}) : current?.state === 'mixed' ? selectionText('next.selection.native.distinct', {count: current.distinctCount}) : '';
  const update = (next: string) => props.onChangesChange(changeScalar(props.changes, field.field, next));
  if (field.type === 'enum' || props.fieldOptions?.[field.field]) return <Select value={value} onValueChange={update} disabled={props.pending} accessibilityLabel={props.fieldLabel(field)} placeholder={current?.state === 'mixed' && !changed ? selectionText('next.selection.native.mixed') : changed || current?.value !== undefined ? selectionText('next.selection.native.notSet') : ''}
    error={props.fieldErrors?.[field.field]} options={props.fieldOptions?.[field.field] ?? (field.allowed ?? []).map(option => ({value: option, label: props.fieldValueLabel?.(field, option) ?? option}))} />;
  return <View>
    <TextField error={props.fieldErrors?.[field.field]} value={value} onChangeText={update} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} editable={!props.pending}
      accessibilityLabel={props.fieldLabel(field)} keyboardType={field.type === 'integer' || field.type === 'number' ? 'numbers-and-punctuation' : 'default'} maxLength={field.maxLength}
      placeholder={changed || current?.state === 'shared' && current.value !== undefined ? selectionText('next.selection.native.notSet') : undefined}
      fieldStyle={{height: 44, borderRadius: 10, backgroundColor: colors.ink, paddingHorizontal: 12, borderWidth: changed ? 2 : 1, borderColor: changed ? colors.accentStrong : colors.line}}
      style={{fontSize: 14.5, paddingRight: 66}} />
    {!focused && !changed && current?.state === 'mixed' ? <View pointerEvents="none" style={{position: 'absolute', left: 12, top: 10, borderRadius: 6, backgroundColor: 'rgba(237,245,250,.09)', paddingHorizontal: 9, paddingVertical: 3}}><SelectionText size={13.5} weight={700}>{selectionText('next.selection.native.mixed')}</SelectionText></View> : null}
    {hint ? <View pointerEvents="none" style={{position: 'absolute', right: 12, top: 15}}><SelectionText size={11.5} secondary style={{color: changed ? colors.accentStrong : colors.textTertiary}}>{hint}</SelectionText></View> : null}
  </View>;
}
export function BulkEditor(props: BulkEditorProps) {
  const {colors} = useTheme();
  const retryRef = useRef<View>(null);
  // Authorized Edit offers are supplied by the controller on every platform.
  // The shared surface remains real on TV; its exact TV geometry/proof awaits the approved recipe.
  const fields = props.schema.filter(field => field.bulk);
  const changes = Object.entries(props.changes);
  const failed = props.result ? failedSelectionIds(props.result.results) : [];
  const close = () => props.onOpenChange(false, 'action');
  const result = props.result;
  const footer = <View style={{gap: 10}}>
    {!result && props.summary.length ? <View style={styles.summary}>
      <View style={styles.summaryHead}><SelectionText size={13} weight={800}>{selectionText('next.selection.native.whatChanges')}</SelectionText><SelectionText size={12.5} secondary>{selectionText('next.selection.native.changes', {count: props.summary.length})}</SelectionText></View>
      {props.summary.map(line => <View key={line.id} style={{flexDirection: 'row', gap: 8}}><View style={{width: 6, height: 6, marginTop: 6, borderRadius: 3, backgroundColor: colors.accentStrong}} /><SelectionText size={12.5}>{line.text}</SelectionText></View>)}
    </View> : null}
    <View style={styles.buttons}>
      <Button variant="glass" size="compact" onPress={close}>{selectionText(result ? 'next.selection.native.close' : 'next.selection.native.cancel')}</Button>
      {result ? failed.length ? <Button ref={retryRef} size="compact" loading={props.pending} onPress={() => props.onRetry(failed)} style={{flex: 1, alignSelf: 'stretch'}}>{failed.length === 1 ? selectionText('next.selection.native.retryFor', {title: props.resultEntries.find(row => row.id === failed[0])?.title ?? ''}) : selectionText('next.selection.native.retry')}</Button> : null
        : <Button size="compact" loading={props.pending} disabled={!changes.length || !fields.length || changes.some(([key]) => !fields.some(field => field.field === key))} onPress={props.onSave} style={{flex: 1, alignSelf: 'stretch'}}>{props.saveLabel}</Button>}
    </View>
  </View>;
  return <SelectionSurface open={props.open} onOpenChange={props.onOpenChange} fullHeight headerAction={<Button variant="icon" size="xs" icon="i-x" accessibilityLabel={selectionText('next.selection.native.close')} onPress={close} style={{width: 34, height: 34}} />} headerContext={props.ownerHeader} title={props.title}
    description={selectionText('next.selection.native.bulkDescription', {count: props.count})} initialFocusRef={failed.length ? retryRef : props.initialFocusRef} returnFocusRef={props.returnFocusRef} testID={props.testID}
    footer={footer} contentStyle={{paddingHorizontal: 18}}>
    {props.artwork}
    {props.error ? <SelectionText style={{color: colors.danger}}>{props.error}</SelectionText> : null}
    {result ? <View style={{gap: 6}}>
      <View style={styles.notice}><SelectionText size={14} weight={700}>{selectionText('next.selection.native.updated', {updated: result.updated, failed: result.failed})}</SelectionText>{failed.length ? <SelectionText size={13} secondary>{selectionText('next.selection.native.savedKept')}</SelectionText> : null}</View>
      {result.results.map(row => {const entry = props.resultEntries.find(item => item.id === row.id);return <View key={`${row.kind}-${row.id}`} style={styles.resultRow}>
        {entry?.artwork ? <View pointerEvents="none" style={{width: 30, height: 45}}>{entry.artwork}</View> : null}
        <View style={{flex: 1, gap: 3}}><SelectionText size={14} weight={700}>{entry?.title}</SelectionText><SelectionText size={12} secondary>{row.ok ? selectionText('next.selection.native.saved') : selectionText(row.code === 'metadata_conflict' ? 'next.selection.native.conflict' : row.code === 'invalid_metadata_repair' ? 'next.selection.native.invalidValue' : row.code === 'unsupported_item_kind' ? 'next.selection.native.unsupportedKind' : row.code === 'not_found' ? 'next.selection.native.notFound' : 'next.selection.native.saveFailed')}</SelectionText></View>
        {!row.ok ? <Button variant="text" size="small" disabled={props.pending} onPress={() => props.onRetry([row.id])}>{selectionText('next.selection.native.retry')}</Button> : null}
        <Icon name={row.ok ? 'i-check' : 'i-warn'} color={row.ok ? colors.healthy : colors.danger} size={18} />
      </View>;})}
    </View> : <>
      <View style={styles.fieldGrid}>{fields.map(field => <View key={field.field} style={{width: field.type === 'list' || field.type === 'multiline' ? '100%' : '48.5%', gap: 5}}>
        <View style={styles.label}><SelectionText size={12.5} weight={700} secondary>{props.fieldLabel(field)}</SelectionText>{props.changes[field.field] ? <Button variant="text" size="small" onPress={() => props.onChangesChange(removeFieldChange(props.changes, field.field))} style={{height: 20, paddingHorizontal: 0}} textStyle={{fontSize: 12.5}}>{selectionText('next.selection.native.changed')}</Button> : null}</View>
        {field.type === 'list' ? <ListField {...props} field={field} /> : <ScalarField {...props} field={field} />}
      </View>)}</View>
      {!fields.length ? <SelectionText>{selectionText('next.selection.native.noBulkFields')}</SelectionText> : null}
      <View style={styles.notice}><SelectionText size={12.5}>{selectionText('next.selection.native.oneAtTime', {fields: defaultI18n.list(props.singleItemFields.filter(field => !field.bulk).map(props.fieldLabel))})}</SelectionText></View>
      <Switch variant="selection" checked={props.lockEdited} onCheckedChange={props.onLockEditedChange} disabled={props.pending} description={selectionText('next.selection.native.lockDescription')}>{selectionText('next.selection.native.lock')}</Switch>
    </>}
  </SelectionSurface>;
}
const styles = StyleSheet.create({fieldGrid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, paddingTop: 8}, label: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 18}, chips: {flexDirection: 'row', flexWrap: 'wrap', padding: 8, borderRadius: 10, gap: 6, backgroundColor: '#071018', borderWidth: 1, borderColor: '#28404f'}, summary: {gap: 3, padding: 12, borderRadius: 12, backgroundColor: 'rgba(64,159,212,.1)', borderWidth: 1, borderColor: 'rgba(92,179,226,.3)'}, summaryHead: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4}, buttons: {flexDirection: 'row', gap: 10}, notice: {marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: 'rgba(237,245,250,.05)', gap: 4}, resultRow: {flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#28404f'}});
