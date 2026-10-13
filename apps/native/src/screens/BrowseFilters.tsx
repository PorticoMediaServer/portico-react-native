import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, TVFocusGuideView, View} from 'react-native';
import type {BrowseCapabilities, BrowseFacetValue, BrowseFieldCapability, BrowsePositionAnchor, BrowseSortSelection} from '../../../../packages/client-core/src/browse';
import {formatBrowseAnchor} from '../../../../packages/client-core/src/browse';
import {activeRangePreset, browseValueLabel, fieldSelectionSummary, filterControlOf, filterValuesField, nextToolbarSort, orderFilterValues, rangePresets, toolbarModel, type ToolbarGroupId} from '../../../../packages/client-core/src/presentation/index';
import {fieldLabel, predicateLabel, quickFilterLabel, useFacets, type Predicate} from '../app/browse';
import {Button, Divider, Field, Focusable, ListRow, Menu, Notice, Sheet, Surface, Text, alpha, useTheme, type FocusableHandle, type MenuItem} from '../ui';
import {say} from '../app/errors';
import {useI18n, type I18n} from '../app/i18n';
import {RowGuide} from './title/RowGuide';

/**
 * The browse toolbar on iPhone, iPad and television, drawn from the shared model (`toolbarModel`
 * in client-core), the same shape as the web's: one Sort control that shows field and direction,
 * the play-state and favorite quick toggles, the library kind's promoted filters as their own
 * buttons, "Filter" with everything else in three groups, and the applied filters as removable
 * chips with Clear all.
 *
 * Filters open as a grouped list with each field's current selection on the right; a field opens
 * its values as a second level. On television that is a panel at the side, two short lists deep,
 * and nothing in it needs typing.
 */
export function BrowseBar({libraryId, capabilities, predicates, onChange, sort, onSort, total, onSaveView, owner = false, fixedSort = false, inline = false, trailing}: {/** Television: just Sort and Filter as two buttons for the tabs' row; every filter is in the side panel. */ inline?: boolean; /** Drawn after the buttons in the inline form (Jump to). */ trailing?: React.ReactNode; /** The tab has its own order (Recently aired): no Sort control. */ fixedSort?: boolean; onSaveView?: (name: string) => Promise<void>; libraryId: string; capabilities: BrowseCapabilities; predicates: readonly Predicate[]; onChange: (next: readonly Predicate[]) => void; sort: BrowseSortSelection; onSort: (next: BrowseSortSelection) => void; total?: number; /** Owners also get the availability filter. */ owner?: boolean}) {
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const model = useMemo(() => toolbarModel(capabilities, capabilities.library.kind, predicates, sort, {owner, textEntry: !isTV}), [capabilities, predicates, sort, owner, isTV]);
  const hasSort = !fixedSort && model.sorts.length > 0;
  /** The filter sheet: closed, the grouped list, or one field's values (opened from the list or straight from a promoted button). */
  const [filters, setFilters] = useState<{field?: BrowseFieldCapability; direct?: boolean} | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const pivotId = capabilities.resolvedPivot?.id ?? '';
  const same = (a: Predicate, b: Predicate) => a.field === b.field && a.operator === b.operator && JSON.stringify(a.value) === JSON.stringify(b.value);
  const quickNode = (id: string) => { const q = model.quick.find(f => f.id === id); return q && 'field' in q.query ? (q.query as Predicate) : undefined; };
  const isQuickOn = (id: string) => { const n = quickNode(id); return !!n && predicates.some(p => same(p, n)); };
  const toggleQuick = (id: string) => { const n = quickNode(id); if (!n) return; onChange(isQuickOn(id) ? predicates.filter(p => !same(p, n)) : [...predicates.filter(p => p.field !== n.field), n]); };
  /** A field's own predicates; Year is stored by decade. */
  const mineOf = (f: BrowseFieldCapability) => predicates.filter(p => p.field === f.id || (f.id === 'year' && p.field === 'decade'));
  const setField = (f: BrowseFieldCapability, mine: readonly Predicate[]) => onChange([...predicates.filter(p => p.field !== f.id && !(f.id === 'year' && p.field === 'decade')), ...mine]);
  const summaryOf = (f: BrowseFieldCapability) => fieldSelectionSummary({...f, id: f.id}, mineOf(f).map(p => ({...p, field: f.id})), v => valueText(i18n, f, String(v)));
  const [saving, setSaving] = useState(false);
  const [viewName, setViewName] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const saveView = async () => {
    if (!onSaveView) return;
    setSaveBusy(true); setSaveError('');
    try { await onSaveView(viewName.trim()); setSaving(false); } catch (e) { setSaveError(say(e, 'library', 'save')); } finally { setSaveBusy(false); }
  };
  // Sort is one control: it names the field and the direction, and choosing the current field flips it.
  const sortCap = capabilities.sorts.find(x => x.id === sort.field);
  const sortLabel = model.sort.flippable ? i18n.t('lib.sortChip', {field: fieldLabel(sort.field, sortCap?.labelKey), direction: directionLabel(i18n, sort.field, sort.direction)}) : fieldLabel(sort.field, sortCap?.labelKey);
  const sortItems: MenuItem[] = model.sorts.map(x => ({id: x.id, label: fieldLabel(x.id, x.labelKey), selected: x.id === sort.field, detail: x.id === sort.field && model.sort.flippable ? directionLabel(i18n, sort.field, sort.direction) : undefined, icon: x.id === sort.field ? (sort.direction === 'desc' ? 'chevronDown' as const : 'chevronUp' as const) : undefined}));
  const groupTitle: Record<ToolbarGroupId, string> = {title: i18n.t('filter.group.title'), activity: i18n.t('filter.group.activity'), file: i18n.t('filter.group.file')};
  const open = filters?.field;
  const closeFilters = () => setFilters(null);
  const overlays = (
    <>
      <Menu open={sortOpen} onClose={() => setSortOpen(false)} title={i18n.t('sort.title')} items={sortItems} onSelect={id => { setSortOpen(false); onSort(nextToolbarSort(capabilities, sort, id)); }} />
      <Sheet
        open={!!filters}
        onClose={closeFilters}
        title={open ? fieldLabel(open.id, open.labelKey) : i18n.t('filter.title')}
        subtitle={open ? summaryOf(open) : predicates.length ? i18n.t('lib.activeFilters', {count: predicates.length}) : i18n.t('lib.narrow')}
        kind="form"
        placement={isTV ? 'side' : 'auto'}
        cancelLabel={null}
        leading={open
          ? (filters?.direct ? {label: i18n.t('filter.clear'), disabled: !mineOf(open).length, onPress: () => setField(open, [])} : {label: i18n.t('filter.title'), onPress: () => setFilters({})})
          : {label: i18n.t('lib.clearAll'), disabled: !predicates.length, onPress: () => onChange([])}}
        primary={{label: i18n.t('lib.done'), onPress: closeFilters}}>
        {open ? (
          <FieldValues libraryId={libraryId} field={open} predicates={mineOf(open)} onChange={mine => setField(open, mine)} />
        ) : (
          <View style={{gap: space.lg}}>
            {model.groups.map((group, g) => (
              <View key={group.id} style={{gap: space.xs}}>
                <Text variant="label" tone="tertiary" style={{paddingHorizontal: space.md}}>{groupTitle[group.id]}</Text>
                <Surface padded={false}>
                  {group.fields.map((f, i) => (
                    <View key={f.id}>
                      {i ? <Divider inset={space.md} /> : null}
                      <ListRow title={fieldLabel(f.id, f.labelKey)} meta={summaryOf(f)} accessory="navigation" hasTVPreferredFocus={isTV && g === 0 && i === 0} onPress={() => setFilters({field: f})} />
                    </View>
                  ))}
                </Surface>
              </View>
            ))}
          </View>
        )}
      </Sheet>
    </>
  );
  // Television: two buttons beside the tabs. Every filter is in the side panel (the list, then one field's values).
  if (inline) {
    return (
      <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
        {hasSort ? <Button size="sm" variant="secondary" icon="sort" label={sortLabel} accessibilityLabel={`${i18n.t('sort.title')}: ${sortLabel}`} onPress={() => setSortOpen(true)} /> : null}
        <Button size="sm" variant="secondary" icon="filter" selected={predicates.length > 0} label={predicates.length ? i18n.t('lib.activeFilters', {count: predicates.length}) : i18n.t('filter.title')} onPress={() => setFilters({})} />
        {trailing}
        {overlays}
      </View>
    );
  }
  return (
    <View style={{gap: space.sm, paddingVertical: space.sm}}>
      {/* TV: a full-width guide that always hands focus to a chip (last used, else the first), so
          arriving from the grid or the tabs never lands on the empty guide itself. */}
      <RowGuide>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: space.xs, paddingHorizontal: space.page, paddingVertical: isTV ? space.xs : 0}} style={isTV ? {overflow: 'visible'} : undefined}>
        {hasSort ? <Button size="sm" variant="secondary" icon="sort" label={sortLabel} accessibilityLabel={`${i18n.t('sort.title')}: ${sortLabel}`} onPress={() => setSortOpen(true)} /> : null}
        {model.quick.map(f => <Button key={f.id} size="sm" variant="secondary" selected={isQuickOn(f.id)} label={quickFilterLabel(f.labelKey)} onPress={() => toggleQuick(f.id)} />)}
        {model.promoted.map(f => { const summary = summaryOf(f); const label = fieldLabel(f.id, f.labelKey); return <Button key={f.id} size="sm" variant="secondary" selected={!!summary} trailingIcon="chevronDown" label={summary ? `${label}: ${summary}` : label} onPress={() => setFilters({field: f, direct: true})} />; })}
        <Button size="sm" variant="secondary" icon="filter" label={i18n.t('filter.add')} onPress={() => setFilters({})} />
        {onSaveView && predicates.length ? <Button size="sm" variant="ghost" icon="bookmark" label={i18n.t('lib.saveView')} onPress={() => { setViewName(''); setSaveError(''); setSaving(true); }} /> : null}
      </ScrollView>
      </RowGuide>
      {model.applied.length ? (
        <RowGuide>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: space.xs, paddingHorizontal: space.page, paddingVertical: isTV ? space.xs : 0}} style={isTV ? {overflow: 'visible'} : undefined}>
          {model.applied.map((p, i) => <Button key={`${p.field}:${i}`} size="sm" variant="secondary" selected trailingIcon="close" label={predicateLabel(p as Predicate, capabilities)} onPress={() => onChange(predicates.filter(x => x !== p))} />)}
          <Button size="sm" variant="ghost" label={i18n.t('lib.clearAll')} onPress={() => onChange([])} />
        </ScrollView>
        </RowGuide>
      ) : null}
      {typeof total === 'number' ? <Text variant="caption" tone="tertiary" style={{paddingHorizontal: space.page}}>{i18n.t('lib.count', {count: total, pivot: pivotId})}</Text> : null}
      <Sheet open={saving} onClose={() => setSaving(false)} title={i18n.t('lib.saveViewTitle')} subtitle={i18n.t('lib.saveViewSubtitle')} kind="form" cancelLabel={i18n.t('lib.cancel')}
        primary={{label: i18n.t('lib.save'), loading: saveBusy, disabled: !viewName.trim() || saveBusy, onPress: () => void saveView()}}>
        <View style={{gap: space.md}}>
          {saveError ? <Notice tone="error" message={saveError} /> : null}
          <Field label={i18n.t('lib.saveViewName')} value={viewName} onChangeText={setViewName} placeholder={i18n.t('lib.saveViewPlaceholder')} maxLength={80} returnKeyType="done" onSubmitEditing={() => { if (viewName.trim()) void saveView(); }} />
          <Text variant="caption" tone="tertiary">{i18n.t('lib.saveViewHelp')}</Text>
        </View>
      </Sheet>
      {overlays}
    </View>
  );
}

function directionLabel(i18n: I18n, field: string, direction: 'asc' | 'desc'): string {
  const kind = /title|name|artist|album|author/.test(field) ? 'alpha' : /added|date|year|release|played|last/.test(field) ? 'date' : /rating/.test(field) ? 'rating' : /duration|length/.test(field) ? 'duration' : 'other';
  return i18n.t('lib.direction', {kind, dir: direction});
}

/** A stored value as its chip and row say it: decades as "1990s", enum tokens as words. */
function valueText(i18n: I18n, field: BrowseFieldCapability, value: string): string {
  if (field.id === 'year' && /^\d{3}0$/.test(value)) return `${value}s`;
  if (field.type === 'boolean') return value === 'true' ? i18n.t('lib.yes') : i18n.t('lib.no');
  return browseValueLabel(value);
}

/**
 * One field's values, as the shared rule classifies it (`filterControlOf`): the library's own
 * values with counts (ticked rows), Any / Yes / No, a short list of choices, or a range offered
 * as presets. Typed text is the last resort and never appears on television.
 */
function FieldValues({libraryId, field, predicates, onChange}: {libraryId: string; field: BrowseFieldCapability; predicates: readonly Predicate[]; onChange: (mine: readonly Predicate[]) => void}) {
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const facets = useFacets(libraryId);
  const control = filterControlOf(field);
  const target = filterValuesField(field);
  const [values, setValues] = useState<readonly BrowseFacetValue[]>();
  const [q, setQ] = useState('');
  const counted = control === 'values' && (field.id === 'year' || !!field.facetSource || field.controlHint === 'facet-multi-select');
  useEffect(() => {
    if (!counted) return;
    let canceled = false;
    const timer = setTimeout(() => { facets(target.facet, q).then(v => { if (!canceled) setValues(v); }, () => { if (!canceled) setValues([]); }); }, q ? 200 : 0);
    return () => { canceled = true; clearTimeout(timer); };
  }, [facets, counted, target.facet, q]);
  const label = fieldLabel(field.id, field.labelKey);
  // TV: counted values arrive after the level opens, by which time focus has settled on Done;
  // it moves to the first value (or the first chosen one) once they are on screen.
  const entry = useRef<FocusableHandle>(null);
  const loaded = values !== undefined;
  useEffect(() => {
    if (!isTV || !loaded) return;
    const timer = setTimeout(() => entry.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [isTV, loaded]);
  const isPreferred = (items: readonly {selected: boolean}[], i: number) => (items.some(x => x.selected) ? items.findIndex(x => x.selected) === i : i === 0);
  const rows = (items: readonly {id: string; title: string; meta?: string; selected: boolean; onPress: () => void}[]) => (
    <Surface padded={false}>
      {items.map((item, i) => (
        <View key={item.id}>
          {i ? <Divider inset={space.md} /> : null}
          <ListRow title={item.title} meta={item.meta} selected={item.selected} focusRef={isPreferred(items, i) ? entry : undefined} hasTVPreferredFocus={isTV && isPreferred(items, i)} onPress={item.onPress} />
        </View>
      ))}
    </Surface>
  );
  if (control === 'values') {
    const chosen = new Set<string>(predicates.flatMap(p => (Array.isArray(p.value) ? p.value.map(String) : p.value === null ? [] : [String(p.value)])));
    const options: readonly BrowseFacetValue[] = orderFilterValues(field, values ?? (field.allowedValues ?? []).map(v => ({value: v, label: v, count: 0})));
    // PERF-S13: chosen values stay visible (first) even when the server's top values don't include
    // them, and the list is capped; typing finds the rest.
    const pinned = [...chosen].filter(v => !options.some(o => o.value === v)).map(v => ({value: v, label: v, count: 0}));
    const shown = [...pinned, ...options].slice(0, Math.max(MAX_VALUES, chosen.size));
    const numeric = field.id === 'year' || field.type === 'number';
    const toggle = (v: string) => { const next = new Set(chosen); if (next.has(v)) next.delete(v); else next.add(v); onChange(next.size ? [{field: target.field, operator: target.operator, value: [...next].map(x => (numeric ? Number(x) : x))} as Predicate] : []); };
    return (
      <View style={{gap: space.sm}}>
        {!isTV && ((values?.length ?? 0) > 10 || q) ? <Field placeholder={i18n.t('lib.findValue', {field: label.toLowerCase()})} value={q} onChangeText={setQ} /> : null}
        {shown.length ? rows(shown.map(o => ({id: o.value, title: o.label && o.label !== o.value ? o.label : valueText(i18n, field, o.value), meta: counted && o.count ? i18n.number(o.count) : undefined, selected: chosen.has(o.value), onPress: () => toggle(o.value)}))) : null}
        {values && !values.length ? <Text variant="caption" tone="tertiary" style={{paddingHorizontal: space.md}}>{i18n.t('lib.nothingToFilter')}</Text> : null}
      </View>
    );
  }
  if (control === 'toggle') {
    const current = predicates[0]?.value;
    return rows([
      {id: 'any', title: i18n.t('lib.any'), selected: current !== true && current !== false, onPress: () => onChange([])},
      {id: 'yes', title: i18n.t('lib.yes'), selected: current === true, onPress: () => onChange([{field: field.id, operator: 'equals', value: true}])},
      {id: 'no', title: i18n.t('lib.no'), selected: current === false, onPress: () => onChange([{field: field.id, operator: 'equals', value: false}])},
    ]);
  }
  if (control === 'choice') {
    const current = String(predicates[0]?.value ?? '');
    return rows([
      {id: 'any', title: i18n.t('lib.any'), selected: !current, onPress: () => onChange([])},
      ...(field.allowedValues ?? []).map(v => ({id: v, title: valueText(i18n, field, v), selected: current === v, onPress: () => onChange([{field: field.id, operator: 'equals', value: v}])})),
    ]);
  }
  if (control === 'range') {
    const presets = rangePresets(field, new Date());
    const active = activeRangePreset(presets, predicates);
    return rows([
      {id: 'any', title: i18n.t('lib.any'), selected: !predicates.length, onPress: () => onChange([])},
      ...presets.map(p => ({id: p.id, title: i18n.t(p.label.id, p.label.values), selected: active === p.id, onPress: () => onChange(p.predicates as readonly Predicate[])})),
    ]);
  }
  const op = field.operators.includes('contains') ? 'contains' : 'equals';
  return <Field placeholder={i18n.t('lib.fieldValue', {field: label})} defaultValue={String(predicates[0]?.value ?? '')} onEndEditing={e => onChange(e.nativeEvent.text.trim() ? [{field: field.id, operator: op, value: e.nativeEvent.text.trim()}] : [])} style={{paddingVertical: space.xs}} />;
}

/** Values listed at once; the find field reaches the rest. */
const MAX_VALUES = 40;

function JumpTo({index, current, onJump, sortField}: {index: readonly BrowsePositionAnchor[]; current?: string; onJump: (key: string) => void; /** Engine sort the anchors were computed under; labels format from it. */ sortField?: string}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const [open, setOpen] = useState(false);
  const label = (key: string) => formatBrowseAnchor(key, sortField ?? 'title', i18n.t('library.anchorNoValue'));
  return (
    <View>
      <Button size="sm" variant="secondary" icon="search" label={current ? i18n.t('lib.jumpToLetter', {letter: label(current)}) : i18n.t('lib.jumpTo')} onPress={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title={i18n.t('lib.jumpTo')} kind="picker" placement="center">
        <TVFocusGuideView autoFocus style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center', paddingVertical: space.sm}}>
          {index.map(a => <Button key={a.key} variant={a.key === current ? 'primary' : 'secondary'} label={label(a.key)} hasTVPreferredFocus={a.key === current} onPress={() => { setOpen(false); onJump(a.key); }} style={{minWidth: 72}} />)}
        </TVFocusGuideView>
      </Sheet>
    </View>
  );
}

/** Position rail for a sorted grid (M20); each key is a server-computed position. A column on the right on handheld, a row on TV. */
export function AlphabetRail({index, current, onJump, sortField}: {index: readonly BrowsePositionAnchor[]; current?: string; onJump: (key: string) => void; /** Engine sort the anchors were computed under; labels format from it. */ sortField?: string}) {
  const {space, colors, isTV, metrics, type} = useTheme();
  const i18n = useI18n();
  if (index.length < 4) return null;
  const label = (key: string) => formatBrowseAnchor(key, sortField ?? 'title', i18n.t('library.anchorNoValue'));
  const key = (a: BrowsePositionAnchor) =>
    isTV ? (
      <Focusable key={a.key} accessibilityRole="button" accessibilityLabel={i18n.t('lib.jumpToLetterLabel', {letter: label(a.key)})} radius={metrics.radius.small} scale={1} ring={false} onPress={() => onJump(a.key)} style={{width: 34, height: 30, borderRadius: metrics.radius.small}}>
        {({focused}) => (
          <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: metrics.radius.small, backgroundColor: focused ? alpha(colors.white, 0.14) : 'transparent'}}>
            <Text style={[type.caption, {fontSize: 14, fontWeight: '600', color: current === a.key ? colors.accent : focused ? colors.text : colors.textTertiary}]}>{label(a.key)}</Text>
          </View>
        )}
      </Focusable>
    ) : (
      <Pressable key={a.key} accessibilityRole="button" accessibilityLabel={i18n.t('lib.jumpToLetterLabel', {letter: label(a.key)})} onPress={() => onJump(a.key)} hitSlop={4} style={({pressed}) => ({width: 18, height: 16, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1})}>
        <Text style={[type.caption, {fontSize: 10, fontWeight: '600', color: current === a.key ? colors.accent : colors.textTertiary}]}>{label(a.key)}</Text>
      </Pressable>
    );
  // TV-LIB-02 / APL-LIB-03: on television one "Jump to" button opens large letter keys.
  if (isTV) return <JumpTo index={index} current={current} onJump={onJump} sortField={sortField} />;
  return (
    <View pointerEvents="box-none" style={{position: 'absolute', right: 2, top: 0, bottom: 0, justifyContent: 'center'}}>
      <View style={{gap: 1, paddingVertical: space.xs, paddingHorizontal: 2, borderRadius: metrics.radius.pill, backgroundColor: alpha(colors.ink, 0.6)}}>{index.map(key)}</View>
    </View>
  );
}

