import React, {useEffect, useState} from 'react';
import {Linking, View} from 'react-native';
import {deviceNoun} from '../bridge/device-platform';
import QRCode from 'react-native-qrcode-svg';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useI18n} from '../app/i18n';
import type {ContentStackParams} from '../app/routes';
import {useSession} from '../app/session';
import {ConfirmSheet, ListRow, Page, PageHeader, RowGroup, Surface, Text, ToggleRow, isTV, showToast, useInitialFocus, useTheme, type IconName} from '../ui';
import {useOffline} from '../app/downloads';
import {offlineDownloads} from '../bridge/offline-downloads';
import {formatBytes} from '../../../../packages/client-core/src/presentation/content';
import {HostedChooser} from './auth/HostedChooser';
import {DirectSignIn} from './auth/DirectSignIn';
import {knownDirectServers} from '../bridge/known-servers';
import {friendlyHost} from '../app/content';
import type {KnownDirectServer} from '../../../../packages/client-core/src/known-servers';

/** Kept for existing imports (Downloads): the switch row now lives in `ui`. */
export {ToggleRow} from '../ui';

function useBack() {
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  return () => navigation.goBack();
}

/** The device noun in copy: "this iPhone", "this tablet", "this Apple TV". */
export function useDeviceNoun(): string {
  const i18n = useI18n();
  return i18n.t(deviceNoun);
}

/**
 * A task that belongs on the web (APL-SET-02 §4, APL-SET-01 §4). Touch: a row that opens the
 * page. Television: the page as a QR code and a printed address, since there is no browser.
 */
export function WebHandoff({url, title, subtitle, icon = 'external'}: {url: string; title: string; subtitle?: string; icon?: IconName}) {
  const {colors, space} = useTheme();
  const i18n = useI18n();
  const shown = url.replace(/^https?:\/\//, '');
  if (!isTV) return <RowGroup><ListRow icon="globe" title={title} subtitle={subtitle} trailingIcon={icon} onPress={() => { Linking.openURL(url).catch(() => showToast({message: i18n.t('link.openFailed', {address: shown}), icon: 'warning'})); }} /></RowGroup>;
  return (
    <Surface>
      <View style={{flexDirection: 'row', gap: space.xl, alignItems: 'center'}}>
        <View style={{padding: space.sm, backgroundColor: colors.white, borderRadius: 12}}><QRCode value={url} size={200} backgroundColor={colors.white} color={colors.ink} /></View>
        <View style={{flex: 1, gap: space.sm}}>
          <Text variant="subheading">{title}</Text>
          {subtitle ? <Text variant="body" tone="secondary">{subtitle}</Text> : null}
          <Text variant="body" tone="secondary">{i18n.t('settings.openOnWeb', {url: shown})}</Text>
        </View>
      </View>
    </Surface>
  );
}

/** Sign out, behind a tier-1 confirmation (APL-SET-02 §3). */
export function SignOutConfirm({open, onClose}: {open: boolean; onClose: () => void}) {
  const session = useSession();
  const i18n = useI18n();
  const device = useDeviceNoun();
  // Downloads stay on the device through a sign-out unless the person takes them with them. Only
  // their own are theirs to remove; another profile's are never listed here.
  const offline = useOffline();
  const [removing, setRemoving] = useState(false);
  useEffect(() => { if (!open) setRemoving(false); }, [open]);
  const mine = offline.supported && offline.entries.length > 0;
  const signOut = async () => {
    if (removing) for (const entry of offline.entries) await offlineDownloads.remove(entry).catch(() => {});
    session.signOut();
  };
  return (
    <ConfirmSheet open={open} onDismiss={onClose} title={i18n.t('settings.signOutConfirm.title', {server: session.system?.name ?? i18n.t('servers.fallbackName'), device})}
      consequence={removing ? i18n.t('settings.signOutConfirm.bodyRemoving') : i18n.t(isTV ? 'settings.signOutConfirm.bodyTV' : 'settings.signOutConfirm.bodyDownloads')} confirmLabel={i18n.t('action.signOut')} onConfirm={signOut}>
      {mine ? <RowGroup><ToggleRow title={i18n.t('settings.signOutConfirm.removeDownloads')} subtitle={formatBytes(offline.usedBytes)} value={removing} onChange={setRemoving} /></RowGroup> : null}
    </ConfirmSheet>
  );
}

export function ServersScreen() {
  const session = useSession();
  const i18n = useI18n();
  const {space} = useTheme();
  const back = useBack();
  const [mode, setMode] = useState<'list' | 'switch' | 'direct'>('list');
  const [target, setTarget] = useState<string>();
  const entry = useInitialFocus();
  // Servers this device signed in to directly (no credentials kept; choosing one signs in again).
  const [known, setKnown] = useState<readonly KnownDirectServer[]>([]);
  useEffect(() => { void knownDirectServers.list().then(setKnown, () => {}); }, [mode]);
  // A server that is also one of the account's is listed once, under "Your servers".
  const direct = known.filter(k => !session.servers.some(s => s.id === k.serverId));
  if (mode === 'switch') return <HostedChooser title={i18n.t('servers.switch')} initialServerId={target} onBack={() => { setTarget(undefined); setMode('list'); }} />;
  if (mode === 'direct') return <DirectSignIn onBack={() => { session.direct.resetPin(); session.clearError(); setMode('list'); }} />;
  const current = session.session?.viewer.serverId;
  const how = i18n.t(session.session?.viewer.authority === 'hosted' ? 'settings.connectedThroughAccount' : 'settings.connectedDirectly');
  return (
    <View style={{flex: 1}}>
      <Page>
        <PageHeader title={i18n.t('servers.title')} onBack={back} />
        <View style={{paddingHorizontal: space.page, gap: space.xl}}>
          <RowGroup title={i18n.t('servers.connectedTo')}>
            <ListRow icon="server" title={session.system?.name ?? i18n.t('servers.fallbackName')} subtitle={session.system?.version ? `${how} · ${i18n.t('servers.version', {version: session.system.version})}` : how} />
          </RowGroup>
          {session.servers.length ? (
            <RowGroup title={i18n.t('servers.yours')}>
              {/* A named server opens its profiles directly; the current one is only a label. */}
              {session.servers.map((s, i) => s.id === current
                ? <ListRow key={s.id} icon="server" title={s.name} selected meta={i18n.t('profile.current')} />
                : <ListRow key={s.id} hasTVPreferredFocus={isTV && entry && i === session.servers.findIndex(v => v.id !== current)} icon="server" title={s.name} meta={s.presence ? i18n.t(s.presence.online ? 'web.servers.online' : 'web.servers.offline') : undefined} accessory="navigation" onPress={() => { setTarget(s.id); setMode('switch'); }} />)}
            </RowGroup>
          ) : null}
          {direct.length ? (
            <RowGroup title={i18n.t('servers.direct')}>
              {direct.map(k => k.serverId === current
                ? <ListRow key={k.serverId} icon="server" title={k.name} subtitle={friendlyHost(k.address)} selected meta={i18n.t('profile.current')} />
                : <ListRow key={k.serverId} icon="server" title={k.name} subtitle={friendlyHost(k.address)} accessory="navigation" onPress={() => { session.direct.setOrigin(k.address); setMode('direct'); }} />)}
            </RowGroup>
          ) : null}
          <RowGroup>
            {session.hosted ? <ListRow icon="switch" title={i18n.t('servers.switch')} accessory="navigation" onPress={() => setMode('switch')} /> : null}
            {/* Spec — Hosted at Scale: the list is version-checked at most every few hours; this checks now. */}
            {session.hosted ? <ListRow icon="refresh" title={i18n.t('web.servers.refresh')} meta={session.directoryStatus === 'loading' ? i18n.t('web.chooser.loading') : session.portico.checkedAt ? i18n.t('web.servers.checked', {when: new Date(session.portico.checkedAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}) : undefined} onPress={session.portico.refreshServers} /> : null}
            <ListRow icon="server" title={i18n.t('servers.connectDirect')} accessory="navigation" hasTVPreferredFocus={isTV && entry && !session.servers.length} onPress={() => setMode('direct')} />
          </RowGroup>
        </View>
      </Page>
    </View>
  );
}
