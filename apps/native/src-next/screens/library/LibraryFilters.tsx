import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import type {BrowseNode} from '../../../../../packages/client-core/src/browse';
import {browseToolbarModel} from '../../../../../packages/client-core/src/presentation/kit-model';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {FilterBuilder, type BrowseLabels, type FilterFieldState} from '../../kit/browse';
import {Button} from '../../kit/controls';
import {useFocusRegistry} from '../../kit/focus';
import {BottomSheet, SidePanel} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import {libraryFilterChange, libraryFilterField} from './filter-controls';
import {NativeLibraryFilterDraft} from './filters';
import {nativeLibraryCanSave, type NativeLibrarySnapshot, type NativeLibraryViewDraft} from './model';

export function LibraryFilters({draft, source, runtime, labels, owner, onClose, onSave}: {draft: NativeLibraryFilterDraft; source: NativeLibrarySnapshot; runtime: NativeShellRuntime; labels: BrowseLabels; owner: boolean; onClose: () => void; onSave: (view: NativeLibraryViewDraft) => void}) {
  const theme = useTheme(), registry = useFocusRegistry(), state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const [openFields, setOpenFields] = useState<readonly string[]>(() => !theme.isTV && source.capabilities?.fields.some(field => field.id === 'genre') ? ['genre'] : []), [failure, setFailure] = useState<unknown>();
  const [now] = useState(() => new Date());
  const model = useMemo(() => browseToolbarModel(source.capabilities!, source.library.kind, state.predicates, source.sort!, {...runtime.text, owner, textEntry: !theme.isTV}),
    [source.capabilities, source.library.kind, source.sort, state.predicates, runtime.text, owner, theme.isTV]);
  const panelId = JSON.stringify(['library-filters', runtime.getSnapshot().authority, source.library.id, source.tab.id]);
  const focusPrefix = JSON.stringify([panelId, 'controls']);
  const fields = Object.fromEntries(model.groups.flatMap(group => group.fields.map(field => [field.id, libraryFilterField(field, state.predicates, state.facets[field.id], now)]))) as Readonly<Record<string, FilterFieldState>>;
  const first = model.groups[0]?.fields[0];
  const firstState = first && fields[first.id];
  const firstId = first ? JSON.stringify([JSON.stringify([focusPrefix, 'field', first.id]), ...(firstState?.kind === 'toggle' ? ['toggle', 'any'] : ['open'])]) : 'apply';
  const initialFocusRef = useMemo(() => ({current: {focus: () => {registry.focus({regionId: panelId, childId: firstId});}}}), [registry, panelId, firstId]);
  useEffect(() => {draft.refresh(); return () => draft.dispose();}, [draft]);
  useEffect(() => {draft.setOpenFields(openFields);}, [draft, openFields]);
  useEffect(() => {if (!state.open) onClose();}, [onClose, state.open]);
  const close = () => {draft.dispose(); onClose();};
  const result = state.count.value;
  const results = result && defaultI18n.t(result.totalIsLowerBound ? 'lib.countAtLeast' : 'lib.count', {count: result.total, pivot: source.tab.pivot ?? 'other'});
  const footer = <View style={{flexDirection: 'row', gap: theme.isTV ? 16 : 10}}>
    {!theme.isTV && <Button focusId="save-view" variant="glass" disabled={!nativeLibraryCanSave(source, {predicates: state.predicates, sort: source.sort!})}
      onPress={() => onSave({predicates: state.predicates, sort: source.sort!})}>{defaultI18n.t('next.browse.native.saveView')}</Button>}
    <Button focusId="apply" testID={`${panelId}-apply`} variant="primary" disabled={state.count.phase !== 'ready'} onPress={() => {if (draft.apply()) onClose();}} style={{flex: 1}}>
      {results ? defaultI18n.t('next.browse.native.showResults', {results}) : null}
    </Button>
    {theme.isTV && <Button focusId="clear" variant="glass" onPress={draft.clear}>{defaultI18n.t('next.browse.native.clearAll')}</Button>}
  </View>;
  const content = <>
    {(failure || state.count.phase === 'error') && <StateView {...runtime.error(failure ?? state.count.error, () => {setFailure(undefined); draft.refresh();})}/>}
    {theme.isTV && results && <Text style={[browseType(theme, 22, 400, 0, 33), {color: theme.colors.textTertiary, marginTop: -4, marginBottom: 8}]}>{defaultI18n.t('next.browse.native.resultsMatch', {results})}</Text>}
    <FilterBuilder testID={`${panelId}-fields`} model={model} labels={labels} focusPrefix={focusPrefix} openFields={openFields} fields={fields}
      onFieldOpenChange={(id, open) => setOpenFields(previous => open ? [...previous.filter(value => value !== id), id] : previous.filter(value => value !== id))}
      onFieldChange={(id, value) => {
        const field = source.capabilities!.fields.find(candidate => candidate.id === id);
        if (!field) return;
        try {draft.setPredicates(libraryFilterChange(source.capabilities!, field, state.predicates, value, (source.tab.fixedFilter ?? []) as readonly BrowseNode[], now)); setFailure(undefined);}
        catch (error) {setFailure(error); runtime.reportError(error);}
      }} onSearchChange={draft.search} onRetry={draft.retryFacet}/>
  </>;
  return theme.isTV ? <SidePanel testID={panelId} open={state.open} onOpenChange={open => {if (!open) close();}} title={defaultI18n.t('next.browse.native.filters')}
    width={680} topInset={0} initialFocusRef={initialFocusRef} showClose={false} titleType={{size: 44, weight: 800, tracking: -.03, lineHeight: 52.8}}
    style={{paddingTop: 42, paddingLeft: 56, paddingRight: 96, paddingBottom: 56}} footer={footer}>{content}</SidePanel>
    : <BottomSheet testID={panelId} open={state.open} onOpenChange={open => {if (!open) close();}} title={defaultI18n.t('next.browse.native.filters')}
      headerAction={<Button focusId="clear" variant="text" onPress={draft.clear}>{defaultI18n.t('next.browse.native.clearAll')}</Button>}
      footer={footer} scrollable={false} detents={[580, 780]} showClose={false}>{content}</BottomSheet>;
}
