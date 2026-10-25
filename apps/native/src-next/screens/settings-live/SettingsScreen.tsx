import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Dimensions, Platform, ScrollView, StatusBar, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {settingsStructure, settingsScopeLabel, settingsRowId, searchSettings, readComposite, compositePatch, type SettingsPage, type SettingsRow as Row} from '../../../../../packages/client-core/src/presentation/settings-structure';
import type {PreferenceScope} from '../../../../../packages/client-core/src/preferences';
import {COMMON_LANGUAGES, languageName, MAX_LANGUAGES} from '../../../../../packages/client-core/src/presentation/language-list';
import {localeChoices} from '../../../../../packages/client-core/src/presentation/region-choices';
import {catalogue, defaultI18n, enUS} from '../../../../../packages/i18n/src';
import {resetRecommendations} from '../../../../../packages/client-core/src/recommendation-feedback';
import {nextIcons} from '../../../../../packages/design/src/next-icons';
import {Button, Focusable, Select, Switch, TextField} from '../../kit/controls';
import {FocusRegion, useFocusRegistry} from '../../kit/focus';
import {Icon, type IconName} from '../../kit/Icon';
import {SettingsRow, SettingsSearchResults, LanguageList, type LanguageOption} from '../../kit/shell';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import {StateView} from '../../kit/states';
import {stateSentenceParts} from '../../kit/states/sentence-parts';
import {Dialog, Menu} from '../../kit/overlays';
import type {NativeShellRuntime} from '../../shell/runtime';
import {tvFocusIds} from '../../shell/tv-focus';
import {NativeTVKeyboard} from '../destinations';
import {useDestinationEntryFocus} from '../destinations/useEntryFocus';
import type {NativeSettingsLivePorts} from './ports';
import type {NativeSettingsController} from './settings-controller';
import type {NativeDevicePreferences} from './device-preference-consumer';
import {setNativeScreenChromeHidden} from '../../shell/chrome';
import {Screen, useScreenBack, useScreenEntry} from './Screen';
import {nativeSettingsActionTarget} from './settings-actions';
import {NativeOwnerLibrariesPanel} from './owner-libraries/OwnerLibrariesPanel';
import {ServerHeader} from '../../kit/shell/ServerIdentity';
import {alpha} from '../../kit/shell/visual';
import {NativeLiveOwnerScreen} from './LiveOwnerScreen';
import {NativeLiveOwnerController} from './live-owner-controller';
import {createNativeRecordingsController} from './recordings-controller';
import {nativeRouteCrypto} from '../../platform/server-connections';
import {NativeServerTroubleshooting} from './server/TroubleshootingPage';
import {NativeServerStorage} from './server/StoragePage';
import {NativeServerIntegrations} from './server/IntegrationsPage';
import {NativeServerGeneral} from './server/GeneralPage';
import {PhoneServerPageHeader} from './server/PhoneServerPageHeader';
import {NativeRemoteSourcesScreen} from '../settings/remote-sources/NativeRemoteSourcesScreen';
import QRCode from 'react-native-qrcode-svg';
import {nativeEqualizer} from '../../platform/playback/equalizer';
import {publicTVHandoffAddress} from '../../tv/auth/TVHandoff';

/** Same icon normalization as settings.html: strip one leading i-, look up, fall back. */
export function nativeSettingsIcon(name: string): IconName {
  const key = `i-${name.replace(/^i-/, '')}`;
  return Object.hasOwn(nextIcons, key) ? key as IconName : 'i-sliders';
}

export function NativeSettingsScreen({ports, controller, runtime, devicePreferences}: {ports: NativeSettingsLivePorts; controller: NativeSettingsController; runtime: NativeShellRuntime; devicePreferences: NativeDevicePreferences}) {
  const theme = useTheme(), t = runtime.text.t, registry = useFocusRegistry(), insets = useSafeAreaInsets();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const structure = settingsStructure(ports.settingsContext());
  const accountPages = useMemo(() => structure.headings.find(heading => heading.id === 'account')?.pages ?? [], [structure]);
  const managesServer = ports.context.account.account.role === 'owner';
  // The Server group on the phone draws the pages this client can actually administer; the rest land with their owners.
  const serverPages = useMemo(() => {
    if (theme.isTV) return [];
    const pages = (structure.headings.find(heading => heading.id === 'server')?.pages ?? []).filter(value => value.id === 'dashboard' || value.id === 'libraries' || value.id === 'storage' || value.id === 'troubleshooting' || managesServer && (value.id === 'general' || value.id === 'live' || value.id === 'integrations' || value.id === 'segments' || value.id === 'remote-sources'));
    // settings.html wins over the group's old order: General comes first.
    const general = pages.find(value => value.id === 'general');
    return general ? [general, ...pages.filter(value => value.id !== 'general')] : pages;
  }, [structure, theme.isTV, managesServer]);
  const [selected, setSelected] = useState(accountPages[0]?.id), [query, setQuery] = useState(''), [pushed, setPushed] = useState(false);
  // tv-more frame 22: the list keeps the spec's three groups, in the drawn order; Reading is not on TV.
  const tvPageOrder = ['profile', 'privacy', 'playback', 'languages', 'quality', 'music', 'appearance', 'region', 'device'];
  const tvPageGroups: readonly (readonly string[])[] = [['profile', 'privacy'], ['playback', 'languages', 'quality', 'music'], ['appearance', 'region', 'device']];
  const orderedPages = theme.isTV ? [...tvPageOrder.flatMap(id => accountPages.filter(value => value.id === id)), ...accountPages.filter(value => !tvPageOrder.includes(value.id))] : accountPages;
  const pageRow = (value: SettingsPage) => <Focusable key={value.id} focusId={value.id} testID={`settings-page-${value.id}`} accessibilityRole="button" accessibilityLabel={t(value.title)} accessibilityState={{selected: value.id === page.id}} onFocus={theme.isTV ? () => setSelected(value.id) : undefined} onPress={() => choose(value.id)} focusKind="row" focusRadius={14} style={{minHeight: theme.isTV ? 56 : 48, paddingHorizontal: 20, gap: 18, borderRadius: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: value.id === page.id && !compact ? `${theme.colors.accent}29` : 'transparent'}}>
    <Icon name={nativeSettingsIcon(value.icon)} size={theme.isTV ? 24 : 18}/><Text style={[shellType(theme.isTV ? 22 : 15.5), {color: theme.colors.text}]}>{t(value.title)}</Text>
  </Focusable>;
  const [searching, setSearching] = useState(false), [searchRevision, setSearchRevision] = useState(0);
  const [restoreRevision, setRestoreRevision] = useState(0);
  const liveControllers = useMemo(() => {
    if (!managesServer || theme.isTV) return undefined;
    const lifetime = controller.lifetime;
    const api = {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => lifetime.request(next => ports.context.api.request<T>(path, method, body, next), signal)};
    return {owner: new NativeLiveOwnerController(lifetime, api, () => [...nativeRouteCrypto.random(24)].map(byte => byte.toString(16).padStart(2, '0')).join('')), recordings: createNativeRecordingsController(lifetime, api, ports.dvrRequestId)};
  }, [controller, ports, managesServer, theme.isTV]);
  useEffect(() => () => {liveControllers?.owner.dispose(); liveControllers?.recordings.dispose();}, [liveControllers]);
  const matches = searchSettings({headings: structure.headings.filter(value => value.id === 'account')}, query, t);
  const matchingPages = accountPages.flatMap(value => {
    const found = matches.filter(match => match.address === value.id);
    if (!found.length) return [];
    return [{...value, sections: value.sections.map(section => ({...section, advanced: false, rows: section.rows.filter(row => found.some(match => !match.rowId || match.rowId === settingsRowId(row)))})).filter(section => section.rows.length)}];
  });
  const serverPage = serverPages.find(value => value.id === selected);
  const page = serverPage ?? accountPages.find(value => value.id === selected) ?? accountPages[0];
  const ids = useMemo(() => tvFocusIds(controller.lifetime.authority), [controller]);
  const column = ids.surface('settings.pages'), rows = ids.surface(`settings.rows.${page?.id ?? ''}`), keyboard = ids.surface('settings.keyboard'), searchField = ids.surface('settings.search');
  const enter = useScreenEntry(theme.isTV && page ? {regionId: column, childId: accountPages[0].id} : undefined, controller.lifetime.current);
  useDestinationEntryFocus({visible: theme.isTV && !searching, intent: restoreRevision ? 'enter' : 'restore', revision: restoreRevision}, page ? {regionId: column, childId: page.id} : undefined);
  const remoteSourcesPage = !theme.isTV && page?.id === 'remote-sources';
  const remoteBack = useRef<(() => boolean) | undefined>(undefined);
  const setRemoteBack = useCallback((handler: (() => boolean) | undefined) => {remoteBack.current = handler;}, []);
  const back = useCallback(() => {
    if (remoteSourcesPage) {
      if (remoteBack.current?.()) return true;
      setPushed(false);
      if (theme.width >= 600 && accountPages[0]) setSelected(accountPages[0].id);
      return true;
    }
    if (searching) {setSearching(false); setQuery(''); setRestoreRevision(value => value + 1); return true;}
    if (registry.capture()?.regionId === rows && page) return registry.focus({regionId: column, childId: page.id});
    if (page && page.id !== accountPages[0]?.id) {setSelected(accountPages[0].id); registry.focus({regionId: column, childId: accountPages[0].id}); return true;}
    return false;
  }, [registry, column, rows, page, accountPages, searching, remoteSourcesPage, theme.width]);
  const compact = !theme.isTV && theme.width < 600;
  // A pushed Server page covers the shell chrome, as the frames draw it; phone only.
  useEffect(() => {
    setNativeScreenChromeHidden('settings-pushed', compact && pushed);
    return () => setNativeScreenChromeHidden('settings-pushed', false);
  }, [compact, pushed]);
  useScreenBack(runtime, back, theme.isTV || remoteSourcesPage);
  if (!page) throw new Error('native_settings_structure_empty');
  // Libraries and Live TV draw their own pages and own their scrolling; they are not
  // stacks of rows inside the generic Settings body.
  const librariesPage = !theme.isTV && page.id === 'libraries';
  const livePage = !theme.isTV && page.id === 'live' && liveControllers !== undefined;
  const troubleshootingPage = !theme.isTV && page.id === 'troubleshooting';
  const storagePage = !theme.isTV && page.id === 'storage';
  const integrationsPage = !theme.isTV && page.id === 'integrations';
  const generalPage = !theme.isTV && page.id === 'general';
  const leaveServerPage = () => {const first = accountPages[0]?.id; if (first) {setSelected(first); registry.focus({regionId: column, childId: first});}};
  const choose = (id: string) => {setSelected(id); if (compact) setPushed(true);};
  const viewerRole = ports.context.account.account.role === 'owner' ? 'owner' as const : ports.context.account.canManage ? 'administrator' as const : 'member' as const;
  // Android may report 0 here while the surface still draws under the status bar; StatusBar.currentHeight is the measured fallback.
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0);
  return <Screen style={!theme.isTV ? {paddingTop: topInset + 14} : undefined}>
    <View style={{flex: 1, flexDirection: 'row', gap: theme.isTV ? 80 : 0}}>
      {(!compact || !pushed) && <View style={{width: compact ? '100%' : theme.isTV ? searching ? 500 : 480 : 280}}>
        {(!theme.isTV || !searching) && <Text accessibilityRole="header" style={[shellType(theme.isTV ? 44 : 30, 800), {color: theme.colors.text, marginBottom: 24, marginHorizontal: 20}]}>{t('next.shell.settings')}</Text>}
        <FocusRegion id={searchField} entry="input" edges={{left: ids.rail, down: searching ? `${keyboard}.row.0` : column}}>
          <TextField focusId="input" testID="settings-search" variant="search" leadingIcon="i-search" accessibilityLabel={t('next.shell.searchSettings')} placeholder={t('next.shell.searchSettings')} value={query} onChangeText={setQuery} showSoftInputOnFocus={!theme.isTV}
            onFocus={() => {if (theme.isTV && !searching) {setSearching(true); setSearchRevision(value => value + 1);}}} containerStyle={{marginHorizontal: theme.isTV ? 0 : 16}}/>
        </FocusRegion>
        {theme.isTV && searching ? <View style={{marginTop: 32}}><NativeTVKeyboard id={keyboard} value={query} onChangeText={setQuery} activation={{visible: true, intent: 'enter', revision: searchRevision}} leftRegionId={ids.rail} rightRegionId={matchingPages[0] ? ids.surface(`settings.matches.${matchingPages[0].id}`) : undefined} width={500} testID="settings-keyboard"/></View> : <ScrollView style={{marginTop: 20}}>
          {query.trim().length >= 2 ? <SettingsSearchResults matches={matches} query={query} onNavigate={address => choose(address)}/>
            : <FocusRegion id={column} entry={orderedPages[0].id} order={orderedPages.map(value => value.id)} orientation="vertical" edges={{left: ids.rail, right: rows}} onLayout={enter}>
              <Text style={[shellType(theme.isTV ? 20 : 13, 600), {color: theme.colors.textTertiary, marginLeft: 20, marginBottom: 10}]}>{t('settings.heading.account')}</Text>
              {theme.isTV
                ? tvPageGroups.map((group, index) => <React.Fragment key={group.join('-')}>
                    {index > 0 && <View style={{height: 26}}/>}
                    {group.flatMap(id => orderedPages.filter(value => value.id === id)).map(pageRow)}
                  </React.Fragment>)
                : orderedPages.map(pageRow)}
            </FocusRegion>}
            {theme.isTV && !searching && <View testID="settings-key-hints" style={{gap: 8, marginTop: 34, marginLeft: 20}}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}><KeyCap label={t('next.controls.native.up')}/><KeyCap label={t('next.controls.native.down')}/><Text style={[shellType(15, 400), {color: theme.colors.textTertiary}]}>{t('next.shell.settingsHintChoose')}</Text></View>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}><KeyCap label={t('next.controls.native.right')}/><Text style={[shellType(15, 400), {color: theme.colors.textTertiary}]}>{t('next.shell.settingsHintEdit')}</Text><View style={{width: 12}}/><KeyCap label={t('next.controls.native.left')}/><Text style={[shellType(15, 400), {color: theme.colors.textTertiary}]}>{t('next.shell.settingsHintPages')}</Text></View>
            </View>}
          {!theme.isTV && serverPages.length > 0 && <View style={{marginHorizontal: 16, marginTop: 20, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised, borderWidth: 1, borderColor: alpha(theme.colors.accentStrong, .28)}}>
            <ServerHeader serverName={ports.serverName()} viewerRole={viewerRole} audience={viewerRole === 'administrator' ? 'administrators' : 'owner'} variant="phone"/>
            {serverPages.map(value => <Focusable key={value.id} focusId={value.id} testID={`settings-page-${value.id}`} accessibilityRole="button" accessibilityLabel={t(value.title)} accessibilityState={{selected: value.id === page.id}} onPress={() => value.id === 'dashboard' ? ports.context.navigation.open({kind: 'server-dashboard'}, ports.context.authority()) : choose(value.id)} focusKind="row" focusRadius={10} style={{minHeight: 48, paddingHorizontal: 14, gap: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: value.id === page.id && !compact ? alpha(theme.colors.accent, .16) : 'transparent'}}>
              <View style={{width: 30, height: 30, borderRadius: 8, backgroundColor: alpha(theme.colors.accent, .16), alignItems: 'center', justifyContent: 'center'}}><Icon name={nativeSettingsIcon(value.icon)} size={18} color={theme.colors.accentStrong}/></View>
              <Text numberOfLines={1} style={[shellType(15.5), {color: theme.colors.text, flex: 1}]}>{t(value.title)}</Text><Icon name="i-right" size={18} color={theme.colors.lineStrong}/>
            </Focusable>)}
          </View>}
        </ScrollView>}
      </View>}
      {(!compact || pushed) && <View style={{flex: 1}}>
        {compact && (serverPage ? <PhoneServerPageHeader title={t(page.title)} backLabel={t('next.shell.settings')} onBack={() => {if (!remoteSourcesPage || !remoteBack.current?.()) setPushed(false);}}/>
          : <Button variant="text" size="small" icon="i-left" onPress={() => setPushed(false)}>{t('action.back')}</Button>)}
        {!(theme.isTV && searching) && !librariesPage && !livePage && !troubleshootingPage && !storagePage && !integrationsPage && !generalPage && !remoteSourcesPage && <Text accessibilityRole="header" style={[shellType(theme.isTV ? 44 : 32, 800), {color: theme.colors.text, marginBottom: 28, marginHorizontal: compact ? 20 : 0}]}>{t(page.title)}</Text>}
        {state.error !== undefined && <StateView {...runtime.error(state.error, () => {void controller.refresh();})}/>}
        {remoteSourcesPage ? <NativeRemoteSourcesScreen ports={ports} runtime={runtime} onBackHandlerChange={setRemoteBack}/> : livePage ? <NativeLiveOwnerScreen controller={liveControllers!.owner} recordings={liveControllers!.recordings} ports={ports} runtime={runtime} onClose={leaveServerPage}/> : librariesPage ? <NativeOwnerLibrariesPanel ports={ports} runtime={runtime}/> : troubleshootingPage ? <NativeServerTroubleshooting ports={ports} runtime={runtime}/> : storagePage ? <NativeServerStorage ports={ports} runtime={runtime}/> : integrationsPage ? <NativeServerIntegrations ports={ports} runtime={runtime}/> : generalPage ? <NativeServerGeneral ports={ports} runtime={runtime}/> : <ScrollView key={page.id} contentContainerStyle={{paddingHorizontal: compact ? 20 : 0, paddingBottom: 80}}>
          {theme.isTV && searching ? <>
            {query.trim().length >= 2 && !matches.length && <StateView title={t('next.states.noMatches', {query: query.trim()})}/>}
            {matchingPages.map(value => <View key={value.id}><Text accessibilityRole="header" style={[shellType(32, 800), {color: theme.colors.text, marginBottom: 24}]}>{t(value.title)}</Text><SettingsPageBody page={value} ports={ports} controller={controller} runtime={runtime} devicePreferences={devicePreferences} region={ids.surface(`settings.matches.${value.id}`)} column={keyboard}/></View>)}
          </> : <SettingsPageBody page={page} ports={ports} controller={controller} runtime={runtime} devicePreferences={devicePreferences} region={rows} column={column}/>}
        </ScrollView>}
      </View>}
    </View>
  </Screen>;
}

function SettingsPageBody({page, ports, controller, runtime, devicePreferences, region, column}: {page: SettingsPage; ports: NativeSettingsLivePorts; controller: NativeSettingsController; runtime: NativeShellRuntime; devicePreferences: NativeDevicePreferences; region: string; column: string}) {
  const theme = useTheme(), t = runtime.text.t, state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [advanced, setAdvanced] = useState(false);
  // tv-more24: the TV hands anything that needs typing or a password to a phone or computer.
  const settingsCapabilities = ports.settingsContext().capabilities;
  const managesSignIn = settingsCapabilities.manageSignIn ?? (!!settingsCapabilities.localAccount && !settingsCapabilities.porticoMember);
  const managementURL = (() => {
    if (!(theme.isTV && page.id === 'profile' && managesSignIn)) return undefined;
    try {return new URL('/settings/profile', ports.context.api.baseUrl).href;} catch {return undefined;}
  })();
  // Frame 23: a TV row with a value opens its choices in the side sheet; switches still flip in place.
  const [choices, setChoices] = useState<Readonly<{title: string; help?: string; value: string; options: readonly Readonly<{value: string; label: string}>[]; apply: (value: string) => void}>>();
  const [languages, setLanguages] = useState<Readonly<{testID: string; title: string; help?: string; value: readonly LanguageOption[]; available: readonly LanguageOption[]; limit: number; apply: (value: readonly LanguageOption[]) => void}>>();
  const [confirmation, setConfirmation] = useState<'signOut' | 'resetRecommendations'>(), [actionBusy, setActionBusy] = useState(false), [actionError, setActionError] = useState<unknown>();
  const cancel = useRef<View>(null);
  useSyncExternalStore(devicePreferences.subscribe, () => page.sections.flatMap(section => section.rows).filter(row => row.kind === 'composite' && row.storage === 'device').map(row => devicePreferences.read((row as Extract<Row, {kind: 'composite'}>).id)).join('|'));
  useEffect(() => setAdvanced(false), [page.id]);
  const visible = (row: Row) => !('when' in row) || !row.when || state.preferences.effective[row.when.key] === ('equals' in row.when ? row.when.equals : undefined);
  const enabled = (row: Row) => {
    if (!('enableWhen' in row) || !row.enableWhen) return true;
    const value = state.preferences.effective[row.enableWhen.key];
    return value !== undefined && row.enableWhen.in.includes(value);
  };
  const sections = page.sections.filter(section => !section.advanced || advanced);
  const equalizer = useSyncExternalStore(nativeEqualizer.subscribe, nativeEqualizer.getSnapshot);
  const showEqualizer = page.id === 'music' && equalizer.supported;
  useEffect(() => {
    if (showEqualizer && !equalizer.ready && !nativeEqualizer.getSnapshot().pending) void nativeEqualizer.refresh().catch(runtime.reportError);
  }, [showEqualizer, equalizer.ready, runtime.reportError]);
  const rowIds = sections.flatMap(section => [...section.rows.filter(visible).map(settingsRowId), ...(showEqualizer && section.id === 'sound' ? ['settings-equalizer'] : [])]);
  const change = (row: Extract<Row, {kind: 'preference' | 'composite'}>, value: string | number | boolean | readonly string[]) => {
    if (!enabled(row)) return;
    if (row.kind === 'composite' && row.storage === 'device') {void devicePreferences.write(row.id, value as string | boolean).catch(runtime.reportError); return;}
    const patch = row.kind === 'preference' ? {[row.key]: value} : compositePatch(row.id, value as string | boolean);
    const field = state.preferences.registry.fields.find(value => value.key === Object.keys(patch)[0]);
    if (!field) return;
    const scope: PreferenceScope | undefined = row.scope === 'deviceClass' ? field.scopes.find(value => value === 'profile-device-class') : field.scopes.find(value => value === 'profile-server');
    if (!scope) throw new Error('native_settings_scope_unavailable');
    void controller.apply(scope, patch).catch(runtime.reportError);
  };
  const device = Platform.isTV ? Platform.OS === 'ios' ? 'device.noun.appleTV' : String((Platform.constants as {Manufacturer?: string}).Manufacturer ?? '').toLowerCase() === 'amazon' ? 'device.noun.fireTV' : 'device.noun.androidTV'
    : Platform.OS === 'ios' ? (Platform as {isPad?: boolean}).isPad ? 'device.noun.iPad' : 'device.noun.iPhone' : Math.min(Dimensions.get('screen').width, Dimensions.get('screen').height) >= 600 ? 'device.noun.tablet' : 'device.noun.phone';
  return <><FocusRegion id={region} entry={rowIds[0]} order={rowIds} orientation="vertical" edges={{left: column}}>
    {actionError !== undefined && <StateView {...runtime.error(actionError, () => setActionError(undefined))}/>}
    {sections.map(section => <React.Fragment key={section.id}><View style={{marginBottom: theme.isTV ? 30 : 24}}>
      {section.title && <Text style={[shellType(theme.isTV ? 20 : 18, 700), {color: theme.colors.textTertiary, marginLeft: theme.isTV ? 24 : 0, marginBottom: 10}]}>{t(section.title)}</Text>}
      {section.description && <Text style={[shellType(theme.isTV ? 22 : 14), {color: theme.colors.textSecondary, marginBottom: 14}]}>{t(section.description)}</Text>}
      <View style={{backgroundColor: theme.colors.raised, borderRadius: theme.isTV ? 18 : 14}}>{section.rows.filter(visible).map((row, index) => {
        const id = settingsRowId(row);
        if (row.kind === 'custom') return <React.Fragment key={id}>{ports.renderSettingsPanel(row.id, runtime)}</React.Fragment>;
        if (row.kind === 'server-setting') throw new Error('native_account_page_server_row');
        if (row.kind === 'action') {
          const target = nativeSettingsActionTarget(row.id);
          return <SettingsRow key={id} testID={id} destructive={row.destructive} label={t(row.label)} description={row.help ? t(row.help) : undefined} first={index === 0} onPress={() => {
            controller.lifetime.assert();
            if (target === 'linkTV') ports.accountActions.linkTV();
            else if (target === 'customizeHome') ports.context.navigation.open({kind: 'home-customize'}, ports.context.authority());
            else setConfirmation(row.id === 'signOut' ? 'signOut' : 'resetRecommendations');
          }}/>;
        }
        const value = row.kind === 'preference' ? state.preferences.effective[row.key] : row.storage === 'registry' ? readComposite(row.id, key => state.preferences.effective[key]) : devicePreferences.read(row.id);
        if (value === undefined) return null;
        const scope = settingsScopeLabel(row.scope, theme.isTV ? 'tv' : 'phone');
        const copy = {label: t(row.label), description: row.help ? t(row.help) : undefined, scope: scope ? t(scope) : undefined, first: index === 0, dependent: !!row.when || !!row.enableWhen};
        const control = row.control;
        if (theme.isTV && control.type !== 'switch') {
          if (control.type === 'languages') {
            const selected = (Array.isArray(value) ? value : []).map(language => ({id: language, label: languageName(language, key => defaultI18n.has(key) ? t(key as Parameters<typeof t>[0]) : undefined)}));
            const available = COMMON_LANGUAGES.map(language => ({id: language, label: languageName(language, key => defaultI18n.has(key) ? t(key as Parameters<typeof t>[0]) : undefined)}));
            return <SettingsRow key={id} testID={id} {...copy} value={selected.length ? defaultI18n.list(selected.map(language => language.label)) : t('next.shell.native.noLanguages')}
              onPress={() => setLanguages({testID: id, title: copy.label, help: copy.description, value: selected, available, limit: MAX_LANGUAGES, apply: next => change(row, next.map(language => language.id))})}/>;
          }
          const options = control.type === 'choice' ? control.choices.map(choice => ({value: String(choice.value), label: t(choice.label, choice.labelValues)})) : localeChoices(defaultI18n, String(value)).map(choice => ({value: choice.id, label: choice.label}));
          const current = String(value);
          return <SettingsRow key={id} testID={id} {...copy} value={options.find(option => option.value === current)?.label ?? current}
            onPress={() => setChoices({title: copy.label, help: copy.description, value: current, options, apply: next => {
              if (control.type === 'choice') {const choice = control.choices.find(choice => String(choice.value) === next); if (choice) change(row, choice.value);}
              else change(row, next);
            }})}/>;
        }
        const choiceList = control.type === 'choice' ? control.choices : undefined;
        return <SettingsRow key={id} testID={id} {...copy}
          control={control.type === 'switch' ? <Switch testID={id} checked={value === true} accessibilityLabel={t(row.label)} disabled={state.busy || !enabled(row)} onCheckedChange={next => change(row, next)}/>
            : choiceList ? <Select testID={id} accessibilityLabel={t(row.label)} value={String(value)} options={choiceList.map(choice => ({value: String(choice.value), label: t(choice.label, choice.labelValues)}))} onValueChange={next => {const choice = choiceList.find(choice => String(choice.value) === next); if (choice) change(row, choice.value);}} disabled={state.busy}/>
              : control.type === 'languages' ? <LanguageList testID={id} label={t(row.label)} value={(Array.isArray(value) ? value : []).map(id => ({id, label: languageName(id, key => defaultI18n.has(key) ? t(key as Parameters<typeof t>[0]) : undefined)}))} available={COMMON_LANGUAGES.map(id => ({id, label: languageName(id, key => defaultI18n.has(key) ? t(key as Parameters<typeof t>[0]) : undefined)}))} limit={MAX_LANGUAGES} onChange={next => change(row, next.map(value => value.id))}/>
                : <Select testID={id} accessibilityLabel={t(row.label)} value={String(value)} options={localeChoices(defaultI18n, String(value)).map(choice => ({value: choice.id, label: choice.label}))} onValueChange={next => change(row, next)} disabled={state.busy}/>}/>;
      })}{showEqualizer && section.id === 'sound' && <SettingsRow testID="settings-equalizer" label={t('next.media.eq.title')} scope={t('settings.thisDevice')} value={equalizer.ready && equalizer.value ? t(equalizer.value.on ? 'next.settings.on' : 'next.settings.off') : undefined} onPress={() => {controller.lifetime.assert(); ports.context.navigation.open({kind: 'settings-equalizer'}, ports.context.authority());}}/>}</View>
    </View>{managementURL && section.id === 'who' && <ManagementCard url={managementURL}/>}</React.Fragment>)}
    {page.sections.some(section => section.advanced) && <Button testID="settings-advanced" variant="glass" size="small" trailingIcon={advanced ? 'i-up' : 'i-down'} onPress={() => setAdvanced(value => !value)}>{t('settings.section.advanced')}</Button>}
  </FocusRegion>
    <Dialog testID="settings-action-confirm" open={confirmation !== undefined} onOpenChange={open => {if (!open && !actionBusy) setConfirmation(undefined);}} initialFocusRef={cancel}
      title={confirmation === 'signOut' ? t('settings.signOutConfirm.title', {server: ports.serverName(), device: t(device)}) : t('settings.resetRecommendations.confirmTitle')}
      description={t(confirmation === 'signOut' ? theme.isTV ? 'settings.signOutConfirm.bodyTV' : 'settings.signOutConfirm.bodyDownloads' : 'settings.resetRecommendations.confirmBody')}
      footer={<View style={{flexDirection: 'row', gap: 16}}><Button ref={cancel} variant="glass" disabled={actionBusy} onPress={() => setConfirmation(undefined)}>{t('action.cancel')}</Button><Button variant="glass" textStyle={{color: theme.colors.record}} loading={actionBusy} onPress={() => {
        controller.lifetime.assert(); setActionBusy(true);
        const work = confirmation === 'signOut' ? ports.accountActions.signOut() : controller.lifetime.request(signal => resetRecommendations(ports.context.api, {serverId: controller.lifetime.authority.serverId, operationId: ports.requestId(), signal}));
        void work.then(() => {if (controller.lifetime.current()) setConfirmation(undefined);}, error => {if (controller.lifetime.current()) setActionError(error);}).finally(() => {if (controller.lifetime.current()) setActionBusy(false);});
      }}>{t(confirmation === 'signOut' ? 'action.signOut' : 'settings.resetRecommendations.confirm')}</Button></View>}><View/></Dialog>
    {theme.isTV && <Menu testID="settings-value-sheet" open={choices !== undefined} onOpenChange={open => {if (!open) setChoices(undefined);}} presentation="sideSheet"
      title={choices?.title} description={choices?.help} initialFocusId={choices?.value}
      items={choices ? choices.options.map(option => ({id: option.value, label: option.label, selected: option.value === choices.value, onSelect: () => {const apply = choices.apply; setChoices(undefined); apply(option.value);}})) : []}/>}
    {theme.isTV && <Dialog testID="settings-language-sheet" open={languages !== undefined} onOpenChange={open => {if (!open) setLanguages(undefined);}} title={languages?.title} description={languages?.help} placement="side" width={640}>
      {languages && <LanguageList testID={languages.testID} label={languages.title} value={languages.value} available={languages.available} limit={languages.limit} onChange={languages.apply}/>}
    </Dialog>}
  </>;
}

/** tv-more24: the frame's QR card, inline on the profile page. The public URL and its
 * displayed form come from the accounts handoff so no credential or code can enter it. */
function ManagementCard({url}: {url: string}) {
  const theme = useTheme(), address = publicTVHandoffAddress(url), t = defaultI18n.t;
  return <View testID="settings-management-handoff" style={{flexDirection: 'row', alignItems: 'center', gap: 36, paddingVertical: 26, paddingHorizontal: 30,
    borderRadius: 18, backgroundColor: theme.colors.raised, borderWidth: 1, borderColor: `${theme.colors.line}B3`, marginBottom: 30}}>
    <View style={{width: 224, height: 224, padding: 12, borderRadius: 14, backgroundColor: theme.colors.white}}><QRCode value={address.url} size={200}/></View>
    <View style={{flex: 1}}>
      <Text style={[shellType(28, 700, 36.4), {color: theme.colors.text, marginBottom: 14}]}>{t('account.tvHandoffTitle')}</Text>
      <Text style={[shellType(22, 400, 33), {color: theme.colors.textSecondary}]}>{stateSentenceParts(catalogue(defaultI18n.locale)['settings.openOnWeb'] ?? enUS['settings.openOnWeb'], {url: address.display}, ['url']).map((part, index) => <Text key={index}
        style={part.strong ? {color: theme.colors.text, fontWeight: '700'} : undefined}>{part.text}</Text>)}</Text>
    </View>
  </View>;
}

/** tv-more frame 22's key caps: a drawn key beside the action it performs. */
function KeyCap({label}: {label: string}) {
  const theme = useTheme();
  return <View style={{minWidth: 44, height: 32, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1.5, borderColor: `${theme.colors.text}4D`, alignItems: 'center', justifyContent: 'center'}}>
    <Text style={[shellType(13, 700), {color: theme.colors.textSecondary}]}>{label}</Text>
  </View>;
}
