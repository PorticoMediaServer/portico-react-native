import React, {useCallback, useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {settingsStructure, settingsScopeLabel, settingsRowId, searchSettings, readComposite, compositePatch, type SettingsPage, type SettingsRow as Row} from '../../../../../packages/client-core/src/presentation/settings-structure';
import type {PreferenceScope} from '../../../../../packages/client-core/src/preferences';
import {COMMON_LANGUAGES, languageName, MAX_LANGUAGES} from '../../../../../packages/client-core/src/presentation/language-list';
import {defaultI18n, supportedLocales} from '../../../../../packages/i18n/src';
import {nextIcons} from '../../../../../packages/design/src/next-icons';
import {Button, Focusable, Select, Switch, TextField} from '../../kit/controls';
import {FocusRegion, useFocusRegistry} from '../../kit/focus';
import {Icon, type IconName} from '../../kit/Icon';
import {SettingsRow, SettingsSearchResults, LanguageList} from '../../kit/shell';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import {StateView} from '../../kit/states';
import type {NativeShellRuntime} from '../../shell/runtime';
import {tvFocusIds} from '../../shell/tv-focus';
import type {NativeSettingsLivePorts} from './ports';
import type {NativeSettingsController} from './settings-controller';
import {Screen, useScreenBack, useScreenEntry} from './Screen';

/** Same icon normalization as settings.html: strip one leading i-, look up, fall back. */
export function nativeSettingsIcon(name: string): IconName {
  const key = `i-${name.replace(/^i-/, '')}`;
  return Object.hasOwn(nextIcons, key) ? key as IconName : 'i-sliders';
}

export function NativeSettingsScreen({ports, controller, runtime}: {ports: NativeSettingsLivePorts; controller: NativeSettingsController; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = defaultI18n.t, registry = useFocusRegistry();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const structure = settingsStructure(ports.settingsContext());
  const accountPages = structure.headings.find(heading => heading.id === 'account')?.pages ?? [];
  const [selected, setSelected] = useState(accountPages[0]?.id), [query, setQuery] = useState(''), [pushed, setPushed] = useState(false);
  const page = accountPages.find(value => value.id === selected) ?? accountPages[0];
  const ids = useMemo(() => tvFocusIds(controller.lifetime.authority), [controller]);
  const column = ids.surface('settings.pages'), rows = ids.surface(`settings.rows.${page?.id ?? ''}`);
  const enter = useScreenEntry(theme.isTV && page ? {regionId: column, childId: accountPages[0].id} : undefined, controller.lifetime.current);
  const back = useCallback(() => {
    if (registry.capture()?.regionId === rows && page) return registry.focus({regionId: column, childId: page.id});
    if (page && page.id !== accountPages[0]?.id) {setSelected(accountPages[0].id); registry.focus({regionId: column, childId: accountPages[0].id}); return true;}
    return false;
  }, [registry, column, rows, page, accountPages]);
  useScreenBack(runtime, back, theme.isTV);
  if (!page) throw new Error('native_settings_structure_empty');
  const compact = !theme.isTV && theme.width < 600;
  const choose = (id: string) => {setSelected(id); if (compact) setPushed(true);};
  return <Screen>
    <View style={{flex: 1, flexDirection: 'row', gap: theme.isTV ? 80 : 0}}>
      {(!compact || !pushed) && <View style={{width: compact ? '100%' : theme.isTV ? 480 : 280}}>
        <Text accessibilityRole="header" style={[shellType(theme.isTV ? 44 : 30, 800), {color: theme.colors.text, marginBottom: 24, marginHorizontal: theme.isTV ? 20 : 20}]}>{t('next.shell.settings')}</Text>
        <TextField testID="settings-search" variant="search" leadingIcon="i-search" accessibilityLabel={t('next.shell.searchSettings')} placeholder={t('next.shell.searchSettings')} value={query} onChangeText={setQuery} containerStyle={{marginHorizontal: theme.isTV ? 0 : 16}}/>
        <ScrollView style={{marginTop: 20}}>
          {query.trim().length >= 2 ? <SettingsSearchResults matches={searchSettings(structure, query, t)} query={query} onNavigate={address => choose(address)}/>
            : <FocusRegion id={column} entry={accountPages[0].id} order={accountPages.map(value => value.id)} orientation="vertical" edges={{left: ids.rail, right: rows}} onLayout={enter}>
              <Text style={[shellType(theme.isTV ? 20 : 13, 600), {color: theme.colors.textTertiary, marginLeft: 20, marginBottom: 10}]}>{t('settings.heading.account')}</Text>
              {accountPages.map(value => <Focusable key={value.id} focusId={value.id} testID={`settings-page-${value.id}`} accessibilityRole="button" accessibilityLabel={t(value.title)} accessibilityState={{selected: value.id === page.id}} onFocus={theme.isTV ? () => setSelected(value.id) : undefined} onPress={() => choose(value.id)} focusKind="row" focusRadius={14} style={{minHeight: theme.isTV ? 56 : 48, paddingHorizontal: 20, gap: 18, borderRadius: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: value.id === page.id && !compact ? `${theme.colors.accent}29` : 'transparent'}}>
                <Icon name={nativeSettingsIcon(value.icon)} size={theme.isTV ? 24 : 18}/><Text style={[shellType(theme.isTV ? 22 : 15.5), {color: theme.colors.text}]}>{t(value.title)}</Text>
              </Focusable>)}
            </FocusRegion>}
        </ScrollView>
      </View>}
      {(!compact || pushed) && <View style={{flex: 1}}>
        {compact && <Button variant="text" size="small" icon="i-left" onPress={() => setPushed(false)}>{t('action.back')}</Button>}
        <Text accessibilityRole="header" style={[shellType(theme.isTV ? 44 : 32, 800), {color: theme.colors.text, marginBottom: 28, marginHorizontal: compact ? 20 : 0}]}>{t(page.title)}</Text>
        {state.error !== undefined && <StateView {...runtime.error(state.error, () => {void controller.refresh();})}/>}
        <ScrollView key={page.id} contentContainerStyle={{paddingHorizontal: compact ? 20 : 0, paddingBottom: 80}}>
          <SettingsPageBody page={page} ports={ports} controller={controller} runtime={runtime} region={rows} column={column}/>
        </ScrollView>
      </View>}
    </View>
  </Screen>;
}

function SettingsPageBody({page, ports, controller, runtime, region, column}: {page: SettingsPage; ports: NativeSettingsLivePorts; controller: NativeSettingsController; runtime: NativeShellRuntime; region: string; column: string}) {
  const theme = useTheme(), t = defaultI18n.t, state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [advanced, setAdvanced] = useState(false);
  useSyncExternalStore(ports.deviceSettings.subscribe, () => page.sections.flatMap(section => section.rows).filter(row => row.kind === 'composite' && row.storage === 'device').map(row => ports.deviceSettings.read((row as Extract<Row, {kind: 'composite'}>).id)).join('|'));
  useEffect(() => setAdvanced(false), [page.id]);
  const visible = (row: Row) => !('when' in row) || !row.when || state.preferences.effective[row.when.key] === ('equals' in row.when ? row.when.equals : undefined);
  const sections = page.sections.filter(section => !section.advanced || advanced);
  const rowIds = sections.flatMap(section => section.rows.filter(visible).map(settingsRowId));
  const change = (row: Extract<Row, {kind: 'preference' | 'composite'}>, value: string | number | boolean | readonly string[]) => {
    if (row.kind === 'composite' && row.storage === 'device') {void ports.deviceSettings.write(row.id, value as string | boolean).catch(runtime.reportError); return;}
    const patch = row.kind === 'preference' ? {[row.key]: value} : compositePatch(row.id, value as string | boolean);
    const field = state.preferences.registry.fields.find(value => value.key === Object.keys(patch)[0]);
    if (!field) return;
    const scope: PreferenceScope | undefined = row.scope === 'deviceClass' ? field.scopes.find(value => value === 'profile-device-class') : field.scopes.find(value => value === 'profile-server');
    if (!scope) throw new Error('native_settings_scope_unavailable');
    void controller.apply(scope, patch).catch(runtime.reportError);
  };
  return <FocusRegion id={region} entry={rowIds[0]} order={rowIds} orientation="vertical" edges={{left: column}}>
    {sections.map(section => <View key={section.id} style={{marginBottom: theme.isTV ? 30 : 24}}>
      {section.title && <Text style={[shellType(theme.isTV ? 20 : 18, 700), {color: theme.colors.textTertiary, marginLeft: theme.isTV ? 24 : 0, marginBottom: 10}]}>{t(section.title)}</Text>}
      {section.description && <Text style={[shellType(theme.isTV ? 22 : 14), {color: theme.colors.textSecondary, marginBottom: 14}]}>{t(section.description)}</Text>}
      <View style={{backgroundColor: theme.colors.raised, borderRadius: theme.isTV ? 18 : 14}}>{section.rows.filter(visible).map((row, index) => {
        const id = settingsRowId(row);
        if (row.kind === 'custom') return <React.Fragment key={id}>{ports.renderSettingsPanel(row.id, runtime)}</React.Fragment>;
        if (row.kind === 'server-setting') throw new Error('native_account_page_server_row');
        if (row.kind === 'action') return <SettingsRow key={id} testID={id} label={t(row.label)} first={index === 0} onPress={row.id === 'signOut' ? () => {void ports.accountActions.signOut().catch(runtime.reportError);} : undefined}/>;
        const value = row.kind === 'preference' ? state.preferences.effective[row.key] : row.storage === 'registry' ? readComposite(row.id, key => state.preferences.effective[key]) : ports.deviceSettings.read(row.id);
        if (value === undefined) return null;
        const scope = settingsScopeLabel(row.scope, theme.isTV ? 'tv' : 'phone');
        return <SettingsRow key={id} testID={id} label={t(row.label)} description={row.help ? t(row.help) : undefined} scope={scope ? t(scope) : undefined} first={index === 0} dependent={!!row.when}
          control={row.control.type === 'switch' ? <Switch testID={id} checked={value === true} accessibilityLabel={t(row.label)} disabled={state.busy} onCheckedChange={next => change(row, next)}/>
            : row.control.type === 'choice' ? <Select testID={id} accessibilityLabel={t(row.label)} value={String(value)} options={row.control.choices.map(choice => ({value: String(choice.value), label: t(choice.label, choice.labelValues)}))} onValueChange={next => {const choice = row.control.type === 'choice' ? row.control.choices.find(choice => String(choice.value) === next) : undefined; if (choice) change(row, choice.value);}} disabled={state.busy}/>
              : row.control.type === 'languages' ? <LanguageList testID={id} label={t(row.label)} value={(Array.isArray(value) ? value : []).map(id => ({id, label: languageName(id, key => defaultI18n.has(key) ? t(key as Parameters<typeof t>[0]) : undefined)}))} available={COMMON_LANGUAGES.map(id => ({id, label: languageName(id, key => defaultI18n.has(key) ? t(key as Parameters<typeof t>[0]) : undefined)}))} limit={MAX_LANGUAGES} onChange={next => change(row, next.map(value => value.id))}/>
                : <Select testID={id} accessibilityLabel={t(row.label)} value={String(value)} options={supportedLocales.map(locale => ({value: locale, label: locale}))} onValueChange={next => change(row, next)} disabled={state.busy}/>}/>;
      })}</View>
    </View>)}
    {page.sections.some(section => section.advanced) && <Button testID="settings-advanced" variant="glass" size="small" trailingIcon={advanced ? 'i-up' : 'i-down'} onPress={() => setAdvanced(value => !value)}>{t('settings.section.advanced')}</Button>}
  </FocusRegion>;
}
