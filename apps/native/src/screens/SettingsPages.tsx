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
import {forgetSavedCertificate, savedCertificates} from '../bridge/server-connections';
import type {SavedCertificate} from '../bridge/certificate-trust';
import {useOffline} from '../app/downloads';
import {offlineDownloads} from '../bridge/offline-downloads';
import {formatBytes} from '../../../../packages/client-core/src/presentation/content';
import {signInMode, type SignInRequest} from '../app/sign-in-mode';
import {linkViewerKey} from '../shell/pending-link';
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
  const entry = useInitialFocus();
  // Justin (18 Oct 2026): signing in elsewhere takes the whole screen, with this viewer's browsing
  // gone until it ends (`sign-in-mode.ts`); left without signing in, this page shows again with
  // focus on the row it was opened from.
  const viewer = linkViewerKey(session.session?.viewer);
  const [returnTo] = useState(() => signInMode.takeOpener(viewer));
  const signIn = (request: SignInRequest, opener: string) => { session.clearError(); signInMode.open(viewer, request, opener); };
  const first = (opener: string, otherwise: boolean) => isTV && entry && (returnTo ? returnTo === opener : otherwise);
  // Servers this device signed in to directly (no credentials kept; choosing one signs in again).
  const [known, setKnown] = useState<readonly KnownDirectServer[]>([]);
  useEffect(() => { void knownDirectServers.list().then(setKnown, () => {}); }, []);
  // A server that is also one of the account's is listed once, under "Your servers".
  const direct = known.filter(k => !session.servers.some(s => s.id === k.serverId));
  // The owner's own certificates this device trusts, each at its address: forgetting one makes the
  // next connection there check the certificate again.
  const [certificates, setCertificates] = useState<readonly SavedCertificate[]>([]);
  const [forgetting, setForgetting] = useState<SavedCertificate>();
  useEffect(() => { void savedCertificates().then(setCertificates, () => {}); }, [forgetting]);
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
                : <ListRow key={s.id} hasTVPreferredFocus={first(`server:${s.id}`, i === session.servers.findIndex(v => v.id !== current))} icon="server" title={s.name} meta={s.presence ? i18n.t(s.presence.online ? 'web.servers.online' : 'web.servers.offline') : undefined} accessory="navigation" onPress={() => signIn({kind: 'switch', serverId: s.id}, `server:${s.id}`)} />)}
            </RowGroup>
          ) : null}
          {direct.length ? (
            <RowGroup title={i18n.t('servers.direct')}>
              {direct.map(k => k.serverId === current
                ? <ListRow key={k.serverId} icon="server" title={k.name} subtitle={friendlyHost(k.address)} selected meta={i18n.t('profile.current')} />
                : <ListRow key={k.serverId} hasTVPreferredFocus={first(`known:${k.serverId}`, false)} icon="server" title={k.name} subtitle={friendlyHost(k.address)} accessory="navigation" onPress={() => { session.direct.setOrigin(k.address); signIn({kind: 'direct'}, `known:${k.serverId}`); }} />)}
            </RowGroup>
          ) : null}
          {certificates.length ? (
            <RowGroup title={i18n.t('connection.certificate.saved')}>
              {certificates.map(c => <ListRow key={c.address} icon="lock" title={c.address} subtitle={i18n.t('connection.certificate.fingerprint', {fingerprint: c.fingerprint.slice(0, 16) + '…'})} accessory="navigation" onPress={() => setForgetting(c)} />)}
            </RowGroup>
          ) : null}
          <RowGroup>
            {session.hosted ? <ListRow icon="switch" title={i18n.t('servers.switch')} accessory="navigation" hasTVPreferredFocus={first('switch', false)} onPress={() => signIn({kind: 'switch'}, 'switch')} /> : null}
            {/* Spec — Hosted at Scale: the list is version-checked at most every few hours; this checks now. */}
            {session.hosted ? <ListRow icon="refresh" title={i18n.t('web.servers.refresh')} meta={session.directoryStatus === 'loading' ? i18n.t('web.chooser.loading') : session.portico.checkedAt ? i18n.t('web.servers.checked', {when: new Date(session.portico.checkedAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}) : undefined} onPress={session.portico.refreshServers} /> : null}
            <ListRow icon="server" title={i18n.t('servers.connectDirect')} accessory="navigation" hasTVPreferredFocus={first('direct', !session.servers.length)} onPress={() => signIn({kind: 'direct'}, 'direct')} />
          </RowGroup>
        </View>
      </Page>
      <ConfirmSheet open={!!forgetting} onDismiss={() => setForgetting(undefined)} title={i18n.t('connection.certificate.forget')} consequence={forgetting ? i18n.t('connection.certificate.forgetBody', {address: forgetting.address}) : undefined}
        confirmLabel={i18n.t('connection.certificate.forgetAction')} onConfirm={() => { if (forgetting) forgetSavedCertificate(forgetting.address); setForgetting(undefined); }} />
    </View>
  );
}
