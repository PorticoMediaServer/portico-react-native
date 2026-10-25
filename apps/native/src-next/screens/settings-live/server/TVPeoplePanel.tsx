import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {routePath} from '../../../../../../packages/contracts/src/routes';
import {
  parseAccessDevicePage, parseAccessMemberPage, parseInvitationPage,
  type AccessDevice, type AccessMember, type Invitation,
} from '../../../../../../packages/client-core/src/server-administration';
import type {MessageId} from '../../../../../../packages/i18n/src';
import {Focusable} from '../../../kit/controls';
import {shellType} from '../../../kit/shell/visual';
import {StateView} from '../../../kit/states';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeScreenLifetime} from '../lifetime';
import type {NativeSettingsLivePorts} from '../ports';
import {createTVServerReader} from './tv-server-reader';

type People = Readonly<{accounts: readonly AccessMember[]; invitations: readonly Invitation[]; devices: readonly AccessDevice[]}>;

const roleLabel = (role: AccessMember['role']): MessageId =>
  role === 'owner' ? 'next.tvPeople.owner' : role === 'admin' ? 'next.settings.people.adminRole' : 'next.settings.people.memberRole';

/** TV37: the web People page's three groups, read only. Accounts, invitations and
 * devices are the server's own authorized view; a device's session count is the
 * producer's optional fact and is omitted when unknown. */
export function TVPeoplePanel({ports, runtime, lifetime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; lifetime: NativeScreenLifetime}) {
  const theme = useTheme(), t = runtime.text.t;
  const [state, setState] = useState<People>(), [error, setError] = useState<unknown>(), [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    const api = createTVServerReader(ports.context, lifetime);
    setState(undefined); setError(undefined);
    void Promise.all([
      api.request<unknown>(routePath('get_admin_access_members'), 'GET', undefined, abort.signal).then(parseAccessMemberPage),
      api.request<unknown>(routePath('get_admin_access_invitations'), 'GET', undefined, abort.signal).then(parseInvitationPage),
      api.request<unknown>(routePath('get_admin_access_devices'), 'GET', undefined, abort.signal).then(parseAccessDevicePage),
    ]).then(([members, invitations, devices]) => {
      if (!abort.signal.aborted && lifetime.current()) setState({accounts: members.items, invitations: invitations.items.filter(item => item.state === 'pending'), devices: devices.items});
    }, failure => {if (!abort.signal.aborted && lifetime.current()) setError(failure);});
    const retire = () => {abort.abort(); setState(undefined); setError(undefined);};
    lifetime.signal.addEventListener('abort', retire, {once: true});
    return () => {abort.abort(); lifetime.signal.removeEventListener('abort', retire);};
  }, [ports, lifetime, revision]);

  const when = (iso: string | undefined): string | undefined => {
    if (!iso) return undefined;
    const at = new Date(iso);
    if (!Number.isFinite(at.getTime())) return undefined;
    const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.max(0, Math.round((start(new Date()) - start(at)) / 86400000));
    const time = new Intl.DateTimeFormat(runtime.text.locale ?? 'en-US', {hour: 'numeric', minute: '2-digit'}).format(at);
    if (days === 0) return t('next.tvPeople.todayAt', {time});
    if (days === 1) return t('next.tvPeople.yesterdayAt', {time});
    if (days < 7) return t('next.tvPeople.daysAgo', {count: days});
    if (days < 35) return t('next.tvPeople.weeksAgo', {count: Math.floor(days / 7)});
    return t('next.tvPeople.monthsAgo', {count: Math.floor(days / 30)});
  };
  const row = (id: string, title: string, meta: string[], status?: string) => <Focusable key={id} focusId={id} focusKind="row" accessibilityRole="text" accessibilityLabel={[title, ...meta, status].filter(Boolean).join('. ')}
    style={{flexDirection: 'row', gap: 20, alignItems: 'center', padding: 22, marginBottom: 8, borderRadius: 16, backgroundColor: theme.colors.raised}}>
    <View style={{width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.colors.accent}33`}}><Text style={[shellType(22, 700), {color: theme.colors.accentStrong}]}>{title.slice(0, 1).toUpperCase()}</Text></View>
    <View style={{flex: 1, gap: 5}}><Text style={[shellType(26, 700), {color: theme.colors.text}]}>{title}</Text>
      <Text style={[shellType(20), {color: theme.colors.textSecondary}]}>{meta.filter(Boolean).join(' · ')}</Text></View>
    {status && <Text style={[shellType(20, 600), {color: theme.colors.textSecondary, maxWidth: '38%'}]}>{status}</Text>}
  </Focusable>;
  const group = (id: string, title: MessageId, children: React.ReactNode) => <View key={id} style={{marginBottom: 30}}>
    <Text accessibilityRole="header" style={[shellType(24, 700), {color: theme.colors.textSecondary, marginBottom: 12}]}>{t(title)}</Text>
    {children}
  </View>;

  if (error) return <StateView {...runtime.error(error, () => setRevision(value => value + 1))}/>;
  if (!state) return <StateView title={t('status.loading')}/>;
  return <View>
    {group('accounts', 'next.tvPeople.accounts', state.accounts.length ? state.accounts.map(account => {
      const name = account.displayName || account.username;
      const meta = [t(roleLabel(account.role)), t(account.hostedAccountId ? 'next.tvPeople.portico' : 'next.tvPeople.local')];
      if (account.profileNames !== undefined) meta.push(t('next.tvPeople.profiles', {count: account.profileNames.length}));
      const live = account.liveState === 'watching' ? t('next.settings.watchingNow') : account.liveState === 'listening' ? t('next.settings.listeningNow') : undefined;
      const last = when(account.lastActiveAt);
      const status = account.disabled ? t('next.tvPeople.turnedOff') : live ?? (last ? t('next.tvPeople.lastActive', {when: last}) : undefined);
      return row(`account:${account.accountId}`, name, meta, status);
    }) : <StateView title={t('next.tvPeople.noAccounts')}/>)}
    {group('invitations', 'next.tvPeople.invitations', state.invitations.length ? state.invitations.map(invitation => {
      const title = t(invitation.role === 'admin' ? 'next.tvPeople.invitationForAdmin' : 'next.tvPeople.invitationForMember');
      const expires = when(invitation.expiresAt);
      return row(`invitation:${invitation.id}`, title, expires ? [t('next.tvPeople.expires', {when: expires})] : [], t('next.tvPeople.notUsed'));
    }) : <StateView title={t('next.tvPeople.noInvitations')}/>)}
    {group('devices', 'next.tvPeople.devices', state.devices.length ? state.devices.map(device => {
      const meta = [device.platform, when(device.firstSeenAt) ? t('next.tvPeople.firstSeen', {when: when(device.firstSeenAt)}) : ''].filter(Boolean);
      const sessions = device.sessionCount === undefined ? undefined : t('next.tvPeople.sessions', {count: device.sessionCount});
      return row(`device:${device.id}`, device.name, meta, sessions);
    }) : <StateView title={t('next.tvPeople.noDevices')}/>)}
  </View>;
}
