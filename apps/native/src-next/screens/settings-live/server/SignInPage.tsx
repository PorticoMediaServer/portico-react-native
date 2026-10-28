import React, {useCallback, useEffect, useState} from 'react';
import {Linking, ScrollView, Text, View} from 'react-native';
import {ReadOnlySignInClient, type SignInSettings} from '../../../../../../packages/client-core/src/account-move';
import {serverSignInSettingsURL} from '../../../../../../packages/client-core/src/sign-in';
import {Button} from '../../../kit/controls';
import {SettingsRow} from '../../../kit/shell';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {shellType} from '../../../kit/shell/visual';
import {StateView} from '../../../kit/states';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {useSettingsRequestScope} from '../use-settings-request-scope';

/** Native's existing sign-in contract is deliberately read-only. Ownership and
 * sign-in moves continue in this server's authenticated web settings. */
export function NativeServerSignIn({ports, runtime, compactHeader = false, onOpenPage}: {
  ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; compactHeader?: boolean; onOpenPage: (page: 'people' | 'remote') => void;
}) {
  const theme = useTheme(), t = runtime.text.t, context = ports.context;
  const {api, lifetime, authority} = useSettingsRequestScope(context);
  const [answer, setAnswer] = useState<Readonly<{api: typeof api; value?: SignInSettings; error?: unknown}>>(), [revision, setRevision] = useState(0);
  const current = useCallback(() => lifetime.current() && context.account.capabilities.manageSignIn && context.account.account.role === 'owner'
    && context.account.account.primaryProfileId === authority.profileId, [lifetime, context, authority.profileId]);
  useEffect(() => {
    if (!current()) return;
    let active = true;
    const client = new ReadOnlySignInClient(api, {serverId: authority.serverId, isCurrent: () => active && current(), capabilities: () => context.account.capabilities});
    setAnswer(undefined);
    void client.read().then(value => {if (active && current()) setAnswer({api, value});}, error => {if (active && current()) setAnswer({api, error});});
    return () => {active = false; client.dispose();};
  }, [api, authority, context, lifetime, revision, current]);
  const value = answer?.api === api && current() ? answer.value : undefined;
  const error = answer?.api === api && current() ? answer.error : undefined;
  const refresh = () => {if (current()) setRevision(next => next + 1);};
  const openWeb = () => {
    if (!value || !current()) return;
    // Only the selected server's origin is used; no credential or move token is
    // added, and visiting a local server never opens Portico Services.
    void Linking.openURL(serverSignInSettingsURL(context.api.baseUrl)).catch(error => {if (current()) setAnswer({api, value, error});});
  };
  return <ScrollView testID="server-signin" contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40, gap: 14}}>
    <ServerHeader serverName={context.serverName} viewerRole="owner" audience="owner" variant="phone"/>
    {!compactHeader && <Text accessibilityRole="header" style={[shellType(28, 800), {color: theme.colors.text}]}>{t('next.settingsSpec.server.signin.title')}</Text>}
    {error !== undefined && <StateView variant="inline" {...runtime.error(error, refresh)}/>}
    {!value && error === undefined && <Text style={{color: theme.colors.textSecondary}}>{t('next.settings.loading')}</Text>}
    {value && <>
      <View style={{backgroundColor: theme.colors.raised, borderRadius: 14, overflow: 'hidden'}}>
        <SettingsRow first label={t('next.settingsSpec.server.signin.groups.0.rows.0.label')} value={t(value.signIn === 'local' ? 'accounts.session.local' : 'accounts.session.portico')}/>
        <SettingsRow label={t('next.settingsSpec.server.signin.groups.0.rows.2.label')} value={value.owner.username} description={value.owner.email}/>
      </View>
      {value.move && <View style={{padding: 14, gap: 6, backgroundColor: theme.colors.raised, borderRadius: 14}}>
        <Text style={[shellType(15, 700), {color: theme.colors.text}]}>{value.move.stage === 'preview' ? 'Sign-in move preview' : value.move.stage === 'complete' ? 'Sign-in move complete' : value.move.stage === 'cancelled' ? 'Sign-in move cancelled' : value.move.to === 'local' ? t('accounts.settings.movingToLocal') : t('accounts.settings.movingToPortico')}</Text>
        <Text style={{color: theme.colors.textSecondary}}>{value.move.waiting} waiting · {value.move.people} people · {value.move.profiles} profiles</Text>
      </View>}
      <SettingsRow first label={t('settings.server.people')} onPress={() => {if (current()) onOpenPage('people');}}/>
      <SettingsRow first label={t('settings.server.remote')} onPress={() => {if (current()) onOpenPage('remote');}}/>
      <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary}]}>Change the owner or sign-in method in this server’s web settings.</Text>
      <Button testID="server-signin-open-web" variant="glass" onPress={openWeb}>Open sign-in settings in browser</Button>
      <Button size="compact" variant="text" icon="i-refresh" onPress={refresh}>{t('action.refresh')}</Button>
    </>}
  </ScrollView>;
}
