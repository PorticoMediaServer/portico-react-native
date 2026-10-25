import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {LibraryManagementService} from '../../../../../../packages/client-core/src/library-management';
import {Button, Focusable} from '../../../kit/controls';
import {FocusRegion} from '../../../kit/focus';
import {Icon} from '../../../kit/Icon';
import {ServerBand, ServerHeader} from '../../../kit/shell';
import {shellType} from '../../../kit/shell/visual';
import {StateView} from '../../../kit/states';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {tvFocusIds} from '../../../shell/tv-focus';
import {publicTVHandoffAddress} from '../../../tv/auth/TVHandoff';
import {NativeScreenLifetime} from '../lifetime';
import {ownerLibraryCounts, ownerLibraryKind, ownerLibraryState} from '../owner-libraries/presentation';
import type {NativeSettingsLivePorts} from '../ports';
import {Screen, useScreenEntry} from '../Screen';

/** TV36: GET-only library directory. No mutation service is exposed to a control.
 * Composition admits only the owner's primary profile; the lifetime fences every read. */
export function NativeTVServerScreen({ports, runtime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t;
  const lifetime = useMemo(() => new NativeScreenLifetime(ports.context), [ports]);
  const service = useMemo(() => new LibraryManagementService({
    api: {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => lifetime.request(next => ports.context.api.request<T>(path, method, body, next), signal)},
    scope: {serverId: lifetime.authority.serverId, viewerId: JSON.stringify([lifetime.authority.epoch, lifetime.authority.accountId, lifetime.authority.profileId])},
  }), [ports, lifetime]);
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot).directory;
  const ids = useMemo(() => tvFocusIds(lifetime.authority), [lifetime]);
  const column = ids.surface('server.settings.pages'), rows = ids.surface('server.settings.libraries');
  const enter = useScreenEntry({regionId: column, childId: 'libraries'}, lifetime.current);
  useEffect(() => {void service.loadLibraries(); return () => {service.dispose(); lifetime.dispose();};}, [service, lifetime]);
  const address = useMemo(() => {
    try {return publicTVHandoffAddress(new URL('/settings/server-libraries', ports.context.api.baseUrl).href);} catch {return undefined;}
  }, [ports]);
  return <Screen style={{paddingTop: 56}}>
    <ServerBand viewerRole="owner" audience="owner"/>
    <View style={{flex: 1, flexDirection: 'row', gap: 80}}>
      <View style={{width: 480}}>
        <Text accessibilityRole="header" style={[shellType(44, 800), {color: theme.colors.text, marginLeft: 20, marginBottom: 24}]}>{t('next.shell.serverSettings')}</Text>
        <ServerHeader serverName={ports.serverName()} viewerRole="owner" audience="owner" variant="group" style={{padding: 20}}/>
        <FocusRegion id={column} entry="libraries" orientation="vertical" edges={{left: ids.rail, right: rows}} onLayout={enter}>
          <Focusable focusId="dashboard" focusKind="row" accessibilityRole="button" accessibilityLabel={t('next.shell.dashboard')} onPress={() => ports.context.navigation.open({kind: 'server-dashboard'}, lifetime.authority)} style={{minHeight: 50, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16}}>
            <Icon name="i-pulse" size={24}/><Text style={[shellType(24, 600), {color: theme.colors.text}]}>{t('next.shell.dashboard')}</Text>
          </Focusable>
          <Focusable focusId="libraries" focusKind="row" accessibilityRole="text" accessibilityState={{selected: true}} accessibilityLabel={t('settings.server.libraries')} style={{minHeight: 50, paddingHorizontal: 20, borderRadius: 14, backgroundColor: `${theme.colors.accent}29`, flexDirection: 'row', alignItems: 'center', gap: 16}}>
            <Icon name="i-folder" size={24} color={theme.colors.accentStrong}/><Text style={[shellType(24, 600), {color: theme.colors.text}]}>{t('settings.server.libraries')}</Text>
          </Focusable>
        </FocusRegion>
      </View>
      <ScrollView style={{flex: 1}} contentContainerStyle={{paddingBottom: 50}}>
        <View style={{height: 60, overflow: 'hidden'}}><ServerHeader serverName={ports.serverName()} viewerRole="owner" audience="owner"/></View>
        <Text accessibilityRole="header" style={[shellType(44, 800), {color: theme.colors.text, marginBottom: 28}]}>{t('settings.server.libraries')}</Text>
        <FocusRegion id={rows} orientation="vertical" edges={{left: column}}>
          {state.phase === 'loading' && <StateView title={t('status.loading')}/>}
          {state.error && <StateView {...runtime.error(state.error, () => {void service.loadLibraries();})}/>}
          {state.data?.items.map(library => {
            const status = ownerLibraryState(library, {t});
            return <Focusable key={library.id} focusId={library.id} focusKind="row" accessibilityRole="text" accessibilityLabel={library.name} style={{flexDirection: 'row', gap: 20, alignItems: 'center', padding: 22, marginBottom: 8, borderRadius: 16, backgroundColor: theme.colors.raised}}>
              <Icon name={ownerLibraryKind(library.kind).icon} size={30}/>
              <View style={{flex: 1, gap: 5}}><Text style={[shellType(26, 700), {color: theme.colors.text}]}>{library.name}</Text>
                <Text style={[shellType(20), {color: theme.colors.textSecondary}]}>{ownerLibraryCounts(library, t).join(' · ')}</Text>
                <Text style={[shellType(18), {color: theme.colors.textTertiary}]}>{library.source.path}</Text></View>
              <Text style={[shellType(20, 600), {color: status.live ? theme.colors.accentStrong : theme.colors.textSecondary, maxWidth: '40%'}]}>{status.text}</Text>
            </Focusable>;
          })}
          {state.canPrevious && <Button focusId="previous" variant="glass" onPress={() => {void service.previousLibraries();}}>{t('web.pager.previous')}</Button>}
          {state.data?.nextCursor && <Button focusId="next" variant="glass" onPress={() => {void service.nextLibraries();}}>{t('web.pager.next')}</Button>}
        </FocusRegion>
        {address && <View style={{flexDirection: 'row', alignItems: 'center', gap: 22, padding: 24, borderRadius: 18, backgroundColor: theme.colors.raised, marginTop: 24}}>
          <View style={{padding: 10, borderRadius: 10, backgroundColor: theme.colors.white}}><QRCode value={address.url} size={100}/></View>
          <View style={{flex: 1, gap: 10}}><Text style={[shellType(24, 700), {color: theme.colors.text}]}>{t('tv.server.handoffTitle')}</Text><Text style={[shellType(20, 400, 28), {color: theme.colors.textSecondary}]}>{t('tv.server.handoffBody', {url: address.display})}</Text></View>
        </View>}
      </ScrollView>
    </View>
  </Screen>;
}
