import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {HttpLocalApi} from '../../../../packages/client-core/src/index';
import {ACCOUNT_SECURITY_EVENTS, AccountNotificationsClient, type AccountNotification, type NotificationPreferences} from '../../../../packages/client-core/src/account-notifications';
import {say} from '../app/errors';
import {useI18n, type I18n, type MessageId} from '../app/i18n';
import type {ContentStackParams} from '../app/routes';
import {useSession} from '../app/session';
import {nativeNetworkFetch} from '../bridge/server-connections';
import {Button, ListRow, Notice, RowGroup, StateView, Text, ToggleRow, useTheme, type IconName} from '../ui';

/**
 * The Portico Account's own notices (BE-hosted: no push and no alert email, an in-app feed
 * instead): a server that has gone quiet or is nearly full, an accepted invitation, a new
 * sign-in, a security change, an export that is ready, a signing key about to expire. Shown in
 * Notifications for Portico Account sign-ins, above the server's own inbox, with the three
 * choices the account can make about them.
 */
export function AccountFeed() {
  const session = useSession();
  const credentials = session.credentials;
  const hostedUrl = session.hostedUrl;
  const client = useMemo(() => (session.hosted && credentials ? new AccountNotificationsClient(async <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => {
    const live = await credentials.accessSession();
    return new HttpLocalApi(hostedUrl, live.accessToken, nativeNetworkFetch).request<T>(path, method, body, signal);
  }) : undefined), [session.hosted, credentials, hostedUrl]);
  if (!client) return null;
  return <Feed client={client} />;
}

function Feed({client}: {client: AccountNotificationsClient}) {
  const i18n = useI18n();
  const {space, colors} = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const [items, setItems] = useState<readonly AccountNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState<string>();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences>();
  const load = useCallback(async (after?: string) => {
    setBusy(true);
    try {
      const page = await client.page(after);
      setItems(prev => (after ? [...prev, ...page.items.filter(n => !prev.some(p => p.id === n.id))] : page.items));
      setUnread(page.unread);
      setCursor(page.nextCursor);
      setPhase('ready');
      setError('');
    } catch (e) {
      setError(say(e, 'account', 'load'));
      setPhase(prev => (prev === 'ready' ? 'ready' : 'error'));
    } finally {
      setBusy(false);
    }
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { client.preferences().then(setPrefs, () => {}); }, [client]);
  const read = (ids: readonly string[] | 'all') => {
    setItems(prev => prev.map(n => (ids === 'all' || ids.includes(n.id) ? {...n, read: true} : n)));
    setUnread(n => (ids === 'all' ? 0 : Math.max(0, n - ids.length)));
    void client.markRead(ids).catch(() => {});
  };
  const open = (n: AccountNotification) => {
    if (!n.read) read([n.id]);
    // A new sign-in is reviewed where the account's devices are listed.
    if (n.kind === 'new_device') navigation.push('Account');
  };
  const savePref = (key: keyof NotificationPreferences, value: boolean) => {
    if (!prefs) return;
    const next = {...prefs, [key]: value};
    setPrefs(next);
    client.savePreferences(next).then(setPrefs, e => { setPrefs(prefs); setError(say(e, 'account', 'save')); });
  };
  return (
    <View style={{gap: space.md}}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm}}>
        <Text variant="heading">{i18n.t('account.portico')}</Text>
        {unread > 0 ? <Button variant="ghost" size="sm" icon="check" label={i18n.t('web.account.notif.markAll')} onPress={() => read('all')} /> : null}
      </View>
      {error && phase === 'ready' ? <Notice tone="warning" message={error} action={i18n.t('action.tryAgain')} onAction={() => void load()} /> : null}
      {phase === 'loading' ? <StateView loading title={i18n.t('notifications.loading')} /> : null}
      {phase === 'error' ? <StateView icon="error" title={error} action={i18n.t('action.tryAgain')} onAction={() => void load()} /> : null}
      {phase === 'ready' && !items.length ? <StateView icon="bell" title={i18n.t('web.account.notif.empty')} message={i18n.t('web.account.notif.emptyBody')} /> : null}
      {items.length ? (
        <RowGroup>
          {items.map(n => {
            const {title, body, icon} = describe(n, i18n);
            return <ListRow key={n.id} icon={icon} title={title} subtitle={body} meta={i18n.relativeTime(n.occurredAt)} trailing={!n.read ? <View accessibilityLabel={i18n.t('web.account.notif.unread')} style={{width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent}} /> : undefined} accessory={n.kind === 'new_device' ? 'navigation' : undefined} onPress={() => open(n)} />;
          })}
        </RowGroup>
      ) : null}
      {cursor ? <Button variant="secondary" label={i18n.t('web.account.notif.older')} loading={busy} onPress={() => void load(cursor)} /> : null}
      {prefs ? (
        <RowGroup title={i18n.t('web.account.notif.prefsTitle')} footer={i18n.t('web.account.notif.prefsHelp')}>
          <ToggleRow title={i18n.t('web.account.notif.prefServerOffline')} value={prefs.serverOffline} onChange={v => savePref('serverOffline', v)} />
          <ToggleRow title={i18n.t('web.account.notif.prefStorage')} value={prefs.storageNearlyFull} onChange={v => savePref('storageNearlyFull', v)} />
          <ToggleRow title={i18n.t('web.account.notif.prefJoined')} value={prefs.invitationAccepted} onChange={v => savePref('invitationAccepted', v)} />
        </RowGroup>
      ) : null}
    </View>
  );
}

/** What a notice says: a title, a body line and its glyph, from its kind and detail (web's wording). */
function describe(n: AccountNotification, i18n: I18n): {title: string; body?: string; icon: IconName} {
  const server = n.server?.name ?? '';
  switch (n.kind) {
    case 'server_offline': return {title: i18n.t('web.account.notif.serverOffline', {server}), body: i18n.t('web.account.notif.serverOfflineBody'), icon: 'server'};
    case 'storage_nearly_full': return {title: i18n.t('web.account.notif.storage', {server}), body: i18n.t('web.account.notif.storageBody'), icon: 'warning'};
    case 'invitation_accepted': return {title: i18n.t('web.account.notif.joined', {server}), body: i18n.t('web.account.notif.joinedBody'), icon: 'people'};
    case 'new_device': return {title: i18n.t('web.account.notif.newDevice', {name: n.detail.name || n.detail.app || n.detail.platform || ''}), body: i18n.t('web.account.notif.newDeviceBody'), icon: 'phone'};
    case 'security_event': {
      const event = (ACCOUNT_SECURITY_EVENTS as readonly string[]).includes(n.detail.event ?? '') ? n.detail.event! : '';
      return {title: event ? i18n.t(`web.account.notif.event.${event}` as MessageId) : i18n.t('web.account.notif.security'), body: i18n.t('web.account.notif.securityBody'), icon: 'shield'};
    }
    case 'account_export_ready': return {title: i18n.t('web.account.notif.exportReady'), icon: 'download'};
    case 'signing_key_expiring': return {title: i18n.t('web.account.notif.keyExpiring'), body: i18n.t('web.account.notif.keyExpiringBody', {key: n.detail.keyId ?? '', date: n.detail.expiresAt ? i18n.date(n.detail.expiresAt, 'medium') : ''}), icon: 'warning'};
    default: return {title: i18n.t('web.account.notif.other'), icon: 'bell'};
  }
}
