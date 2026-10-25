import React, {useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Button} from '../../kit/controls';
import {useTheme} from '../../kit/theme';
import {ColourBackdrop} from '../../kit/artwork';
import type {NativeAccountWorkspace, AccountWorkspacePage, AccountWorkspaceSnapshot} from '../../platform/account-workspace';

type CommittedOpening = {source?: NativeAccountWorkspace; active: boolean; failed: boolean};
const waiting: AccountWorkspaceSnapshot = Object.freeze({page: 'menu', phase: 'loading'});
const noSubscribe = () => () => {};
const waitingSnapshot = () => waiting;

/** Account-only settings remain available when no server is connected. */
export function PhoneAccountWorkspace({createSource, username, onDone, onFind, onJoin, onSignOut}: {
  createSource: () => NativeAccountWorkspace; username: string; onDone: () => void; onFind: () => void; onJoin: () => void; onSignOut: () => void;
}) {
  const theme = useTheme(), insets = useSafeAreaInsets(), t = defaultI18n.t;
  const opening = useRef<CommittedOpening | undefined>(undefined);
  const [ticket, setTicket] = useState<CommittedOpening>();
  useLayoutEffect(() => {
    if (opening.current) {opening.current.active = false; opening.current.source?.dispose();}
    const committed: CommittedOpening = {active: true, failed: false}; opening.current = committed;
    try {committed.source = createSource();} catch {committed.failed = true;}
    setTicket(committed);
    return () => {committed.active = false; if (opening.current === committed) opening.current = undefined; committed.source?.dispose();};
  }, [createSource]);
  const source = ticket?.source;
  const state = useSyncExternalStore(source?.subscribe ?? noSubscribe, source?.getSnapshot ?? waitingSnapshot);
  const live = () => !!ticket?.active && opening.current === ticket && (!source || source.getSnapshot() === state);
  const current = () => live() && !!source && source.current();
  const go = (action: () => void) => () => {if (!current() || !ticket) return; ticket.active = false; source?.dispose(); action();};
  const page = (value: Exclude<AccountWorkspacePage, 'menu'>) => () => {if (current()) void source?.open(value);};
  const heading = state.page === 'security' ? t('account.security') : state.page === 'devices' ? t('devices.title')
    : state.page === 'notifications' ? t('web.account.notifications') : t('settings.title');
  const label = (text: string, key?: string) => <Text key={key} style={[theme.type.body, {color: theme.colors.text}]}>{text}</Text>;
  return <View testID="phone-serverless-settings" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ColourBackdrop shape="top"/>
    <ScrollView contentContainerStyle={{paddingTop: insets.top + 20, paddingBottom: Math.max(24, insets.bottom + 16), paddingHorizontal: 24, gap: 18}}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
        <Text accessibilityRole="header" style={[theme.type.title, {color: theme.colors.text}]}>{heading}</Text>
        <Button variant="text" onPress={() => {if (!current()) {if (ticket && live() && (ticket.failed || state.phase === 'ended')) {ticket.active = false; source?.dispose(); onDone();} return;}
          if (state.page === 'menu') go(onDone)(); else source?.menu();}}>{t(state.page === 'menu' || state.phase === 'ended' ? 'action.done' : 'action.back')}</Button>
      </View>
      {ticket?.failed ? label(t('error.unknown')) : state.phase === 'ended' ? label(t('web.hostedAccount.signInAgain')) : <>
        {state.page === 'menu' && source && <>
          {label(username)}
          <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('accounts.session.portico')}</Text>
          <Button variant="glass" onPress={page('security')}>{t('account.security')}</Button>
          <Button variant="glass" onPress={page('devices')}>{t('devices.title')}</Button>
          <Button variant="glass" onPress={go(onDone)}>{t('web.servers.title')}</Button>
          <Button variant="glass" onPress={page('notifications')}>{t('web.account.notifications')}</Button>
          <Button variant="glass" onPress={go(onJoin)}>{t('services.start.join')}</Button>
          <Button variant="glass" onPress={go(onFind)}>{t('connection.discovery.find')}</Button>
          <Button variant="text" onPress={go(onSignOut)}>{t('action.signOut')}</Button>
        </>}
        {state.phase === 'loading' && label(t('status.loading'))}
        {state.phase === 'failed' && <>
          <Text accessibilityRole="alert" style={[theme.type.body, {color: theme.colors.danger}]}>{state.failure}</Text>
          <Button onPress={() => {if (current() && state.page !== 'menu') void source?.open(state.page);}}>{t('action.tryAgain')}</Button>
        </>}
        {state.security && <>
          {label(t('web.password'))}{label(t(state.security.hasPassword ? 'web.hostedSecurity.on' : 'web.hostedSecurity.off'))}
          {label(t('web.hostedSecurity.email'))}{label(state.security.contactAddress || t('web.hostedSecurity.notSet'))}
          {label(t('web.twoStep.title'))}{label(t(state.security.mfaEnabled ? 'web.hostedSecurity.on' : 'web.hostedSecurity.off'))}
          {state.security.mfaEnabled && label(t('web.hostedSecurity.codesLeft', {count: state.security.recoveryCodesRemaining}))}
        </>}
        {state.sessions?.map(row => <View key={row.id} style={{padding: 16, gap: 8, borderRadius: 12, backgroundColor: theme.colors.raised}}>
          {label(t(row.mode === 'native' ? 'web.hostedAccount.anApp' : 'web.hostedAccount.aBrowser'))}
          {row.current && label(t('profile.current'))}
          {label(t('web.hostedAccount.signedInOn', {date: defaultI18n.date(row.createdAt)}))}
          {row.status !== 'active' && label(t('web.hostedAccount.ended'))}
        </View>)}
        {state.page === 'devices' && state.phase === 'ready' && <View style={{flexDirection: 'row', gap: 12}}>
          <Button variant="glass" disabled={!state.sessionsPrevious} onPress={() => {if (current()) void source?.pageSessions('previous');}}>{t('web.hostedAccount.newer')}</Button>
          <Button variant="glass" disabled={!state.sessionsNext} onPress={() => {if (current()) void source?.pageSessions('next');}}>{t('web.hostedAccount.older')}</Button>
        </View>}
        {state.notifications?.length === 0 && label(t('web.account.notif.empty'))}
        {state.notifications?.filter(row => ['server_offline', 'new_device', 'account_export_ready', 'security_event', 'signing_key_expiring'].includes(row.kind) && (row.kind !== 'server_offline' || !!row.server?.name)
          && (row.kind !== 'new_device' || !!row.detail.name) && (row.kind !== 'account_export_ready' || !!row.detail.exportId)).map(row => <View key={row.id} style={{padding: 16, gap: 8, borderRadius: 12, backgroundColor: theme.colors.raised}}>
          {label(row.kind === 'server_offline' && row.server ? t('web.account.notif.serverOffline', {server: row.server.name})
            : row.kind === 'new_device' ? t('web.account.notif.newDevice', {name: row.detail.name ?? ''})
            : row.kind === 'account_export_ready' ? t('web.account.notif.exportReady')
            : row.kind === 'signing_key_expiring' ? t('web.account.notif.keyExpiring') : t('web.account.notif.security'))}
          <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{defaultI18n.date(row.occurredAt)}</Text>
        </View>)}
      </>}
    </ScrollView>
  </View>;
}
