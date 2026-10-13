import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {compositePatch, localeChoices, preferenceValueLabel, readComposite, settingsRowId, settingsStructure, type SettingsCustomId, type SettingsPage as StructurePage, type SettingsRow as StructureRow, type SettingsSection, type SettingsStructure} from '../../../../../packages/client-core/src/presentation/index';
import {formatBytes} from '../../../../../packages/client-core/src/presentation/content';
import type {PreferencePatch, PreferenceValue} from '../../../../../packages/client-core/src/preferences';
import type {MessageId} from '../../../../../packages/i18n/src/index';
import type {ContentStackParams} from '../../app/routes';
import {usePreferences} from '../../app/preferences';
import {useServerPreferences} from '../../app/server-preferences';
import {useAudioRenderAvailability} from '../../app/audio-render-status';
import {useI18n} from '../../app/i18n';
import {useSession} from '../../app/session';
import {useOffline} from '../../app/downloads';
import {friendlyHost} from '../../app/content';
import {say} from '../../app/errors';
import {deviceIdentity} from '../../bridge/setup-codes';
import {ListRow, Menu, Notice, RowGroup, ToggleRow, isTV, useTheme, type MenuItem} from '../../ui';
import {ChangePasswordSheet, DevicesSection, ProfileLimitsSheet, SignOutEverywhereSheet, TwoFactorSection} from '../Security';
import {LocalProfilesSection, useDirectAccount} from '../Profiles';
import {DeleteAccountSheet} from '../DeleteAccount';
import {ServerMembershipSection} from '../ServerMembership';
import {LinkTVSheet} from '../LinkTV';
import {SignOutConfirm, WebHandoff} from '../SettingsPages';
import {LanguageListPicker} from './LanguageListPicker';
import {ResetRecommendationsRow} from './ResetRecommendations';
import {playerSettingsSupport} from '../../bridge/native-listening-kinds';
import {word} from '../../app/new-words';
import {mpvAvailable} from '../../bridge/player-engines';
import {parseEngineSetting} from '../../player/engine-choice';
import {engineSettingStore} from '../../player/engine-setting-store';

/**
 * The Settings structure for this viewer on this device (`settings-structure.ts`): the pages,
 * their order and their rows are authored there; this app only draws them.
 */
export function useSettingsStructure(): SettingsStructure {
  const session = useSession();
  const server = useServerPreferences();
  const account = useDirectAccount();
  const offline = useOffline();
  const registry = server.snapshot?.registry;
  const member = !!account.snapshot?.account.hostedAccountId;
  const canManage = !!account.snapshot?.canManage;
  const manages = session.session?.viewer.role === 'owner';
  // What the last capability probe found of this device: a receiver to pass sound through to,
  // and whether it shows or decodes HDR at all. The rows that turn those off appear with them.
  const probed = useSyncExternalStore(engineSettingStore.subscribeProbed, engineSettingStore.probed);
  return useMemo(() => settingsStructure({
    // The Server heading is the owner's, as on the web: all ten pages on iPhone and iPad, the Dashboard on television.
    owner: manages,
    platform: isTV ? 'tv' : 'phone',
    capabilities: {
      ...(registry ? {preferenceKeys: new Set(registry.fields.map(f => f.key))} : {}),
      localAccount: account.local,
      porticoMember: member,
      hostedAccount: !!session.hosted,
      downloads: offline.supported,
      deviceName: true,
      manageSignIn: account.local && canManage && !member,
      // Speed, gapless, crossfade and volume levelling are offered only where this device's players can do them.
      playbackSpeed: playerSettingsSupport.playbackSpeed,
      audioEffects: playerSettingsSupport.audioEffects,
      // The Player setting is offered where this build carries a second player (mpv).
      playerEngines: mpvAvailable,
      audioPassthrough: probed?.audioPassthrough === true,
      ...(probed ? {hdr: probed.hdr} : {}),
    },
  }), [registry, account.local, member, canManage, manages, session.hosted, offline.supported, probed]);
}

/** Panels that are a group of their own; the rest are rows inside their section's group. */
const GROUP_PANELS: ReadonlySet<SettingsCustomId> = new Set(['identity', 'profiles', 'devices', 'porticoAccount', 'about']);

/** One page of Settings: its sections as row groups. Personal rows save on change. */
export function SettingsPageBody({page, entry}: {page: StructurePage; /** TV: the first row takes focus when the page opens. */ entry?: boolean}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const server = useServerPreferences();
  const [failure, setFailure] = useState<string>();
  const save = (patch: PreferencePatch) => {
    setFailure(undefined);
    void server.set(patch).catch((e: unknown) => setFailure(say(e, 'preferences', 'save')));
  };
  const needsServer = page.sections.some(section => section.rows.some(row => row.kind === 'preference' || (row.kind === 'composite' && row.storage === 'registry')));
  const first = page.sections[0]?.rows[0];
  return (
    <View style={{gap: space.xl}}>
      {failure ? <Notice tone="error" message={failure} /> : null}
      {needsServer && server.error && !server.snapshot ? <Notice tone="warning" title={i18n.t('preferences.unavailableTitle')} message={server.errorCategory && ['offline', 'unreachable', 'timeout'].includes(server.errorCategory) ? i18n.t('preferences.unavailableNetwork', {problem: server.error ?? ''}) : i18n.t('preferences.unavailableServer')} action={i18n.t('action.tryAgain')} onAction={server.reload} /> : null}
      {page.sections.map(section => <SectionView key={section.id} page={page.id} section={section} save={save} entryRow={entry && first ? settingsRowId(first) : undefined} />)}
    </View>
  );
}

function SectionView({page, section, save, entryRow}: {page: string; section: SettingsSection; save: (patch: PreferencePatch) => void; entryRow?: string}) {
  const i18n = useI18n();
  const server = useServerPreferences();
  const [open, setOpen] = useState(!section.advanced);
  // X-02: why this server can't render effects for what's playing, quietly (the group footer).
  const render = useAudioRenderAvailability();
  const footer = page === 'music' && render && !render.available ? render.reason : undefined;
  const has = (key: string) => !!server.snapshot?.registry.fields.some(f => f.key === key);
  // A row that depends on another setting is absent while that setting is off; a registry row waits for the registry.
  const shown = section.rows.filter(row => {
    if (row.kind === 'custom' || row.kind === 'server-setting') return true;
    if (row.when && server.value(row.when.key, row.when.equals) !== row.when.equals) return false;
    if (row.kind === 'preference') return has(row.key);
    if (row.kind === 'composite' && row.storage === 'registry') return !!server.snapshot;
    return true;
  });
  const groups = shown.filter(row => row.kind === 'custom' && GROUP_PANELS.has(row.id));
  const rows = shown.filter(row => !(row.kind === 'custom' && GROUP_PANELS.has(row.id)));
  const draw = (row: StructureRow) => row.kind === 'server-setting' ? null : row.kind === 'custom' ? <Panel key={row.id} id={row.id} entry={entryRow === row.id} /> : <RowView key={settingsRowId(row)} row={row} save={save} entry={entryRow === settingsRowId(row)} />;
  return (
    <>
      {groups.map(draw)}
      {rows.length ? (
        <RowGroup title={!section.advanced && section.title ? i18n.t(section.title) : undefined} footer={footer ?? (section.description ? i18n.t(section.description) : undefined)}>
          {section.advanced ? <ListRow title={i18n.t(section.title ?? 'settings.section.advanced')} trailingIcon={open ? 'chevronUp' : 'chevronDown'} accessibilityState={{expanded: open}} onPress={() => setOpen(o => !o)} /> : null}
          {open ? rows.map(draw) : null}
        </RowGroup>
      ) : null}
    </>
  );
}

/** A row that opens a picker of values (rowSpec `value`). */
function ChoiceRow({title, subtitle, value, options, onChange, hasTVPreferredFocus}: {title: string; subtitle?: string; value: string; options: readonly {id: string; label: string}[]; onChange: (id: string) => void; hasTVPreferredFocus?: boolean}) {
  const [open, setOpen] = useState(false);
  const label = options.find(o => o.id === value)?.label ?? value;
  return (
    <>
      <ListRow title={title} subtitle={subtitle} meta={label} accessory="value" hasTVPreferredFocus={hasTVPreferredFocus} onPress={() => setOpen(true)} />
      <Menu open={open} onClose={() => setOpen(false)} title={title} items={options.map<MenuItem>(o => ({id: o.id, label: o.label, selected: o.id === value}))} onSelect={onChange} />
    </>
  );
}

/** One authored row with this app's controls: a switch, a value that opens a picker, a list of languages, an action. */
function RowView({row, save, entry}: {row: Exclude<StructureRow, {kind: 'custom'} | {kind: 'server-setting'}>; save: (patch: PreferencePatch) => void; entry?: boolean}) {
  const i18n = useI18n();
  const server = useServerPreferences();
  const device = usePreferences();
  const [sheet, setSheet] = useState(false);
  const title = i18n.t(row.label);
  const help = row.help ? i18n.t(row.help) : undefined;
  // Where a setting applies is said on the row, under its help. Only what this installation
  // keeps for itself is "This device"; a device-scoped setting the server keeps is shared by this
  // profile's devices of the same kind, and says so.
  const here = row.kind === 'composite' && row.storage === 'device';
  const subtitle = row.scope === 'device' ? [help, here ? i18n.t('settings.thisDevice') : i18n.t(isTV ? 'settings.scope.allTVs' : 'settings.scope.allPhones')].filter(Boolean).join(' · ') : help;
  const focus = isTV && entry;
  if (row.kind === 'action') {
    if (row.id === 'resetRecommendations') return <ResetRecommendationsRow />;
    if (row.id === 'linkTV') return <><ListRow icon="tvDevice" title={title} subtitle={help} accessory="navigation" hasTVPreferredFocus={focus} onPress={() => setSheet(true)} /><LinkTVSheet open={sheet} onClose={() => setSheet(false)} /></>;
    return <><ListRow icon="signOut" tone="destructive" title={i18n.t(isTV ? 'account.signOutThisTV' : 'action.signOut')} hasTVPreferredFocus={focus} onPress={() => setSheet(true)} /><SignOutConfirm open={sheet} onClose={() => setSheet(false)} /></>;
  }
  const field = row.kind === 'preference' ? server.snapshot?.registry.fields.find(f => f.key === row.key) : undefined;
  const read = (key: string) => server.snapshot?.registry.fields.some(f => f.key === key) ? server.value<PreferenceValue>(key, '') : undefined;
  let value: PreferenceValue | undefined;
  let write: (next: string | number | boolean | readonly string[]) => void;
  if (row.kind === 'preference') {
    value = field ? server.value(row.key, field.default) : undefined;
    write = next => save({[row.key]: next});
  } else if (row.storage === 'registry') {
    value = readComposite(row.id, read);
    write = next => save(compositePatch(row.id, next as string | boolean));
  } else {
    // The device's own values, kept in this installation's store.
    value = row.id === 'reduceMotion' ? device.preferences.reduceMotion : row.id === 'textSize' ? device.preferences.textSize : row.id === 'receiveFromDevices' ? device.preferences.receiveFromDevices
      // The player and the playback fixes: kept by this device, and sent to the server with what this device can play.
      : row.id === 'playerEngine' ? device.preferences.playerEngine : row.id === 'forceStereo' ? device.preferences.forceStereo : row.id === 'disablePassthrough' ? device.preferences.disablePassthrough : row.id === 'disableHdr' ? device.preferences.disableHdr : undefined;
    write = next => {
      if (row.id === 'reduceMotion') device.update({reduceMotion: next === true});
      else if (row.id === 'textSize') device.update({textSize: next === 'large' ? 'large' : 'standard'});
      else if (row.id === 'receiveFromDevices') device.update({receiveFromDevices: next === true});
      else if (row.id === 'playerEngine') device.update({playerEngine: parseEngineSetting(next)});
      else if (row.id === 'forceStereo') device.update({forceStereo: next === true});
      else if (row.id === 'disablePassthrough') device.update({disablePassthrough: next === true});
      else if (row.id === 'disableHdr') device.update({disableHdr: next === true});
    };
  }
  if (value === undefined) return null;
  const control = row.control;
  switch (control.type) {
    case 'switch': return <ToggleRow hasTVPreferredFocus={focus} title={title} subtitle={subtitle} value={value === true} onChange={write} />;
    case 'choice': {
      // A value only an API client could have stored is shown as what it is.
      const known = control.choices.some(c => c.value === value);
      const options = [...(known || row.kind !== 'preference' ? [] : [{id: String(value), label: preferenceValueLabel(row.key, value as string | number)}]), ...control.choices.map(c => ({id: String(c.value), label: i18n.t(c.label as MessageId, c.labelValues)}))];
      return <ChoiceRow hasTVPreferredFocus={focus} title={title} subtitle={subtitle} value={String(value)} options={options} onChange={id => { const picked = control.choices.find(c => String(c.value) === id); if (picked && picked.value !== value) write(picked.value); }} />;
    }
    case 'languages': return <LanguageListPicker title={title} subtitle={subtitle} value={Array.isArray(value) ? (value as readonly string[]) : []} onChange={write} hasTVPreferredFocus={focus} />;
    case 'locale': {
      // X-03: language is a choice, never free text.
      const current = typeof value === 'string' && value ? value : 'auto';
      const options = localeChoices(i18n, current);
      return <ChoiceRow hasTVPreferredFocus={focus} title={title} subtitle={subtitle} value={current} options={options} onChange={write} />;
    }
  }
}

/** The `custom` rows of the account pages, drawn natively. */
function Panel({id, entry}: {id: SettingsCustomId; entry?: boolean}) {
  switch (id) {
    case 'identity': return <Identity entry={entry} />;
    case 'profiles': return <Profiles />;
    case 'password': return <PasswordRow />;
    case 'twoStep': return <TwoFactorSection leading />;
    case 'devices': return <Devices />;
    case 'porticoAccount': return <PorticoAccount />;
    case 'servers': return <ConnectedServer />;
    case 'deviceName': return <DeviceName entry={entry} />;
    case 'downloadsStorage': return <DownloadsStorage />;
    case 'about': return <About entry={entry} />;
    default: return null;
  }
}

function Identity({entry}: {entry?: boolean}) {
  const session = useSession();
  const i18n = useI18n();
  const account = useDirectAccount();
  const hosted = session.hosted;
  const snapshot = account.snapshot;
  const profile = snapshot?.profiles.find(p => p.id === session.session?.viewer.profileId)?.name;
  return (
    <>
      {account.error && !snapshot ? <Notice tone="error" message={account.error} action={i18n.t('action.tryAgain')} onAction={account.reload} /> : null}
      <RowGroup title={i18n.t('account.signedInAs')}>
        <ListRow readable hasTVPreferredFocus={isTV && entry} icon="account" title={hosted ? hosted.account.displayName ?? hosted.account.username : snapshot?.account.username ?? i18n.t('account.serverAccount')} subtitle={profile ? i18n.t('account.usingProfile', {name: profile}) : undefined} />
      </RowGroup>
    </>
  );
}

/** A direct sign-in manages its profiles here (name, picture, PIN, limits); television hands that to a phone or computer. */
function Profiles() {
  const session = useSession();
  const i18n = useI18n();
  const account = useDirectAccount();
  const [limits, setLimits] = useState<{id: string; name: string}>();
  const serverUrl = session.serverUrl ?? session.api?.baseUrl ?? '';
  if (!account.local) return null;
  if (isTV) return serverUrl ? <WebHandoff url={`${serverUrl.replace(/\/$/, '')}/settings/profile`} title={i18n.t('account.tvHandoffTitle')} /> : null;
  if (!account.snapshot) return null;
  if (!account.snapshot.canManage) return <Notice tone="info" message={i18n.t('account.onlyMainProfileManages')} />;
  return <><LocalProfilesSection account={account} onLimits={setLimits} />{limits ? <ProfileLimitsSheet profile={limits} onClose={() => setLimits(undefined)} /> : null}</>;
}

function PasswordRow() {
  const i18n = useI18n();
  const [open, setOpen] = useState(false);
  return <><ListRow icon="lock" title={i18n.t('account.changePasswordTitle')} accessory="navigation" onPress={() => setOpen(true)} /><ChangePasswordSheet open={open} onClose={() => setOpen(false)} /></>;
}

function Devices() {
  const i18n = useI18n();
  const account = useDirectAccount();
  const [open, setOpen] = useState(false);
  return (
    <>
      <DevicesSection />
      {!isTV && account.snapshot?.canManage ? <RowGroup><ListRow icon="signOut" tone="destructive" title={i18n.t('account.signOutEverywhere.action')} onPress={() => setOpen(true)} /></RowGroup> : null}
      {!isTV ? <SignOutEverywhereSheet open={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** What the Portico Account itself manages (on its site), and this server account's membership through it. */
function PorticoAccount() {
  const session = useSession();
  const i18n = useI18n();
  const account = useDirectAccount();
  const [deleting, setDeleting] = useState(false);
  const hosted = session.hosted;
  return (
    <>
      {account.local && !isTV && account.snapshot ? <ServerMembershipSection snapshot={account.snapshot} onChanged={account.reload} /> : null}
      {hosted ? <WebHandoff url={`${session.hostedUrl.replace(/\/$/, '')}/account`} title={i18n.t('account.manageHosted')} subtitle={isTV ? i18n.t('account.hostedManagedAt') : i18n.t('account.manageHostedHelp')} /> : null}
      {hosted && !isTV ? <RowGroup><ListRow icon="trash" tone="destructive" title={i18n.t('account.delete.row')} onPress={() => setDeleting(true)} /></RowGroup> : null}
      {hosted && !isTV ? <DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} /> : null}
    </>
  );
}

function ConnectedServer() {
  const session = useSession();
  const i18n = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const how = i18n.t(session.session?.viewer.authority === 'hosted' ? 'settings.connectedThroughAccount' : 'settings.connectedDirectly');
  return <ListRow icon="server" title={session.system?.name ?? i18n.t('servers.fallbackName')} subtitle={[friendlyHost(session.serverUrl) ?? how, session.system?.version ? i18n.t('servers.version', {version: session.system.version}) : ''].filter(Boolean).join(' · ')} accessory="navigation" onPress={() => navigation.push('Servers')} />;
}

/** What this device is called in every device list: the name it has in the system's own Settings. */
function DeviceName({entry}: {entry?: boolean}) {
  const i18n = useI18n();
  const [name, setName] = useState<string>();
  useEffect(() => { void deviceIdentity().then(d => setName(d.deviceName), () => {}); }, []);
  return <ListRow readable hasTVPreferredFocus={isTV && entry} title={i18n.t('settings.row.deviceName')} meta={name ?? ''} />;
}

function DownloadsStorage() {
  const i18n = useI18n();
  const offline = useOffline();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  return <ListRow icon="download" title={i18n.t('settings.row.downloadsStorage')} subtitle={i18n.t('settings.downloadsStorage.free', {free: formatBytes(offline.freeBytes)})} meta={formatBytes(offline.usedBytes)} accessory="navigation" onPress={() => navigation.push('Downloads')} />;
}

function About({entry}: {entry?: boolean}) {
  const session = useSession();
  const i18n = useI18n();
  const none = i18n.t('about.notAvailable');
  // The installed build's version (CFBundleShortVersionString), from the native runtime.
  const [version, setVersion] = useState<string>();
  useEffect(() => { void deviceIdentity().then(d => setVersion(d.appVersion), () => {}); }, []);
  return (
    <RowGroup footer={`${i18n.t('about.legal')} ${i18n.t('about.datasetCredit')}`}>
      <ListRow readable hasTVPreferredFocus={isTV && entry} title={i18n.t('about.appVersion')} meta={version ?? none} />
      <ListRow readable title={i18n.t('about.server')} meta={session.system?.name ?? none} />
      <ListRow readable title={i18n.t('about.serverVersion')} meta={session.system?.version ?? none} />
    </RowGroup>
  );
}
