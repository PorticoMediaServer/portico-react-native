import React, {useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import type {RemoteAccess, RemoteConfiguration} from '../../../../../../packages/client-core/src/remote-access';
import type {ConnectivityStatus} from '../../../../../../packages/client-core/src/server-administration';
import {secureConnectionView} from '../../../../../../packages/client-core/src/server-admin/secure-connection';
import {remoteStatusLine} from '../../../../../../packages/client-core/src/server-admin/status-words';
import type {CertificateDraft, CertificateStatus, ConnectivityDraft} from '../../../../../../packages/client-core/src/server-admin/server-forms';
import {Button, Focusable, Select, Switch, TextField} from '../../../kit/controls';
import {Icon} from '../../../kit/Icon';
import {BottomSheet} from '../../../kit/overlays';
import {SettingsRow} from '../../../kit/shell';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {shellType} from '../../../kit/shell/visual';
import {StateView} from '../../../kit/states';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeSettingsLivePorts} from '../ports';
import {useFormState, useStorageForms, useStorageSet, type StorageForms} from './storage/forms';

const IDS = ['remote', 'connectivity', 'certificate'] as const;

/** Settings › Server › Remote access on the phone and tablet. Every status and field
 * comes from the owner's real remote/connectivity/certificate forms; the server's own
 * remote status words decide the health line, and a missing read is never shown as off. */
export function NativeRemoteAccessPage({ports, runtime, compactHeader = false}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; compactHeader?: boolean}) {
  const group = useStorageForms(ports, IDS, runtime.reportError);
  return group ? <RemoteAccessPage key={group.mount} group={group} ports={ports} runtime={runtime} compactHeader={compactHeader}/> : null;
}

function RemoteAccessPage({group, ports, runtime, compactHeader}: {group: StorageForms; ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; compactHeader: boolean}) {
  const theme = useTheme(), t = runtime.text.t, context = ports.context;
  const {forms, set} = group, state = useStorageSet(group);
  const remoteState = useFormState<RemoteConfiguration, RemoteAccess>(forms.remote);
  const connectivityState = useFormState<ConnectivityDraft, ConnectivityStatus>(forms.connectivity);
  const certificateState = useFormState<CertificateDraft, CertificateStatus>(forms.certificate);
  const [advanced, setAdvanced] = useState(false);
  const remote = remoteState.draft, connectivity = connectivityState.draft;
  const certificate = certificateState.status;
  const failed = remoteState.loadError ?? connectivityState.loadError;
  if (failed !== undefined && (!remote || !connectivity)) return <StateView {...runtime.error(failed, () => {void forms.remote.load(); void forms.connectivity.load(); void forms.certificate.load();})}/>;
  if (!remote || !connectivity) {
    if (remoteState.unavailable || connectivityState.unavailable) return <StateView title={t('settings.server.remote.notSetUp')}/>;
    return <StateView title={t('status.loading')}/>;
  }
  const remoteLine = remoteStatusLine(t, {unavailable: remoteState.status === undefined, remote: remoteState.status, connectivity: connectivityState.status, certificate});
  const secure = secureConnectionView({certificate, own: connectivityState.status?.tls.customCertificate});
  const secureBody = certificateState.loadError !== undefined || certificateState.loading ? undefined
    : certificate ? t(secure.body, secure.address ? {address: secure.address} : undefined)
      : certificateState.unavailable ? t('web.connectivity.customCertNotInUse') : undefined;
  const role = context.account.account.role === 'owner' ? 'owner' : 'administrator';
  const signInOptions = [
    {value: 'allow', label: t('settings.server.signIn.allow')},
    {value: 'owner-only', label: t('settings.server.signIn.owner-only')},
    {value: 'off', label: t('settings.server.signIn.off')},
  ];
  const lines = (value: readonly string[]) => value.join('\n');
  const parseLines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
  return <View style={{flex: 1}}>
    <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40}}>
      <ServerHeader serverName={context.serverName} viewerRole={role} audience={role === 'administrator' ? 'administrators' : 'owner'} variant="phone" style={{marginBottom: 12}}/>
      {!compactHeader && <Text accessibilityRole="header" style={[shellType(28, 800, 33, -.03), {color: theme.colors.text}]}>{t('settings.server.remote')}</Text>}
      <View testID="remote-access-status" style={{borderRadius: 14, backgroundColor: theme.colors.raised, padding: 16, marginTop: 14, flexDirection: 'row', gap: 12}}>
        <View style={{width: 9, height: 9, borderRadius: 5, marginTop: 5, backgroundColor: remoteLine.tone === 'healthy' ? theme.colors.healthy : remoteLine.tone === 'warning' ? theme.colors.amber : theme.colors.textTertiary}}/>
        <View style={{flex: 1}}>
          <Text style={[shellType(15, 700), {color: theme.colors.text}]}>{remoteLine.text || t('settings.server.remote.notSetUp')}</Text>
          {secureBody ? <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textSecondary, marginTop: 4}]}>{secureBody}</Text> : null}
        </View>
      </View>

      {remote && connectivity ? <>
        <Text style={[shellType(13, 700), {color: theme.colors.textTertiary, marginTop: 22, marginBottom: 8}]}>{t('web.connectivity.outside')}</Text>
        <View style={{borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
          <SettingsRow testID="remote-access-enabled" first label={t('web.network.remoteTitle')} description={t('web.network.remoteHelp')}
            control={<Switch testID="remote-access-enabled-switch" checked={remote.enabled} onCheckedChange={value => forms.remote.set(current => ({...current, enabled: value}))}/>}/>
          <SettingsRow testID="remote-access-policy" label={t('web.connectivity.whoMaySignIn')}
            control={<Select testID="remote-access-policy-select" value={connectivity.remoteSignInPolicy} options={signInOptions} onValueChange={value => forms.connectivity.set(current => ({...current, remoteSignInPolicy: value as ConnectivityDraft['remoteSignInPolicy']}))}/>}/>
        </View>
        <Text style={[shellType(13, 700), {color: theme.colors.textTertiary, marginTop: 22, marginBottom: 8}]}>{t('settings.server.homeNetwork')}</Text>
        <View style={{borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
          <SettingsRow testID="remote-access-discovery" first label={t('web.connectivity.discovery')}
            control={<Switch testID="remote-access-discovery-switch" checked={connectivity.lanDiscoveryEnabled} onCheckedChange={value => forms.connectivity.set(current => ({...current, lanDiscoveryEnabled: value}))}/>}/>
          <SettingsRow testID="remote-access-dlna" label={t('settings.server.dlna')} description={t('settings.server.dlnaHelp')}
            control={<Switch testID="remote-access-dlna-switch" checked={connectivity.dlnaEnabled} onCheckedChange={value => forms.connectivity.set(current => ({...current, dlnaEnabled: value}))}/>}/>
        </View>
        <View style={{borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised, marginTop: 22}}>
          <Focusable testID="remote-access-advanced" accessibilityRole="button" accessibilityLabel={t('next.settingsSpec.server.remote.advanced.groups.0.rows.0.label')} onPress={() => setAdvanced(true)} focusKind="row" focusRadius={10}
            style={{minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12}}>
            <Text style={[shellType(15.5), {color: theme.colors.text, flex: 1}]}>{t('next.settingsSpec.server.remote.advanced.groups.0.rows.0.label')}</Text>
            <Icon name="i-right" size={18} color={theme.colors.lineStrong}/>
          </Focusable>
        </View>
        {state.dirty ? <View style={{flexDirection: 'row', gap: 8, marginTop: 16}}>
          <Button variant="glass" disabled={state.saving} onPress={() => set.discard()}>{t('action.discard')}</Button>
          <Button loading={state.saving} disabled={Boolean(state.problem)} onPress={() => {void set.save();}}>{t('action.save')}</Button>
        </View> : null}
        {state.problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record, marginTop: 8}]}>{t(state.problem as Parameters<typeof t>[0])}</Text> : null}
      </> : <StateView title={t('status.loading')}/>}
    </ScrollView>
    <BottomSheet open={advanced} onOpenChange={setAdvanced} title={t('next.settingsSpec.server.remote.advanced.groups.0.rows.0.label')} keyboardAvoiding>
      {remote && connectivity ? <ScrollView contentContainerStyle={{gap: 14, paddingBottom: 24}}>
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12}}>
          <Text style={[shellType(15, 600), {color: theme.colors.text, flex: 1}]}>{t('next.settingsSpec.server.remote.groups.1.rows.0.label')}</Text>
          <Switch checked={connectivity.ownAddressEnabled === true} onCheckedChange={value => forms.connectivity.set(current => ({...current, ownAddressEnabled: value}))}/>
        </View>
        <TextField label={t('next.settingsSpec.server.remote.groups.1.rows.0.children.0.label')} description={t('next.settingsSpec.server.remote.groups.1.rows.0.children.0.help')} value={connectivity.customCertificateDomain} editable={connectivity.ownAddressEnabled === true}
          onChangeText={value => forms.connectivity.set(current => ({...current, customCertificateDomain: value}))}/>
        <TextField label={t('next.settingsSpec.server.remote.groups.1.rows.0.children.1.label')} description={t('next.settingsSpec.server.remote.groups.1.rows.0.children.1.help')} value={connectivity.customCertificatePath} editable={connectivity.ownAddressEnabled === true}
          onChangeText={value => forms.connectivity.set(current => ({...current, customCertificatePath: value}))}/>
        <TextField label={t('next.settingsSpec.server.remote.groups.1.rows.0.children.2.label')} description={t('next.settingsSpec.server.remote.groups.1.rows.0.children.2.help')} value={connectivity.customCertificateKeyPath} editable={connectivity.ownAddressEnabled === true}
          onChangeText={value => forms.connectivity.set(current => ({...current, customCertificateKeyPath: value}))}/>
        <TextField label={t('web.network.publicPort')} value={String(remote.publicPort)} keyboardType="number-pad"
          onChangeText={value => {const next = Number(value); if (Number.isInteger(next) && next >= 1 && next <= 65535) forms.remote.set(current => ({...current, publicPort: next}));}}/>
        <TextField label={t('web.network.gateway')} description={t('web.network.gatewayHelp')} value={remote.gateway}
          onChangeText={value => forms.remote.set(current => ({...current, gateway: value}))}/>
        <TextField label={t('web.connectivity.advertiseUrl')} description={t('settings.server.advertiseUrlHelp')} value={connectivity.advertiseUrl}
          onChangeText={value => forms.connectivity.set(current => ({...current, advertiseUrl: value}))}/>
        <TextField label={t('web.connectivity.extraAddresses')} description={t('settings.server.extraAddressesHelp')} value={lines(connectivity.accessUrls)} multiline
          onChangeText={value => forms.connectivity.set(current => ({...current, accessUrls: parseLines(value)}))}/>
        <TextField label={t('web.connectivity.trustedProxies')} description={t('settings.server.trustedProxiesHelp')} value={lines(connectivity.trustedProxies)} multiline
          onChangeText={value => forms.connectivity.set(current => ({...current, trustedProxies: parseLines(value)}))}/>
        <TextField label={t('web.connectivity.homeNetworks')} description={t('settings.server.homeNetworksHelp')} value={lines(connectivity.lanNetworks)} multiline
          onChangeText={value => forms.connectivity.set(current => ({...current, lanNetworks: parseLines(value)}))}/>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 12}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}><Switch checked={remote.mapping} onCheckedChange={value => forms.remote.set(current => ({...current, mapping: value}))}/><Text style={[shellType(14), {color: theme.colors.text}]}>{t('web.network.mappingTitle')}</Text></View>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}><Switch checked={remote.upnp} onCheckedChange={value => forms.remote.set(current => ({...current, upnp: value}))}/><Text style={[shellType(14), {color: theme.colors.text}]}>{t('settings.server.mapping.upnp')}</Text></View>
        </View>
      </ScrollView> : <StateView title={t('status.loading')}/>}
    </BottomSheet>
  </View>;
}
