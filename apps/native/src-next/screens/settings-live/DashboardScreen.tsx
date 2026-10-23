import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {healthFacts} from '../../../../../packages/client-core/src/server-admin/dashboard';
import {formatBytes} from '../../../../../packages/client-core/src/presentation/content';
import {alertName, jobName} from '../../../../../packages/client-core/src/server-admin/console-catalogue';
import {playedFraction} from '../../../../../packages/client-core/src/server-admin/now-playing';
import {Button, Focusable} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {ServerBand, ServerHeader, type ServerFact} from '../../kit/shell';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import {Artwork} from '../../kit/artwork';
import type {NativeShellRuntime} from '../../shell/runtime';
import {tvFocusIds} from '../../shell/tv-focus';
import {Screen, ScreenText, useScreenEntry} from './Screen';
import type {NativeSettingsLivePorts} from './ports';
import type {NativeDashboardController} from './dashboard-controller';

/** TV never exposes a mutation, secret, settings document or inferred administrator action. */
export function NativeDashboardScreen({controller, ports, runtime, deniedFallback}: {controller: NativeDashboardController; ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; deniedFallback: React.ReactNode}) {
  const theme = useTheme(), t = defaultI18n.t;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const ids = useMemo(() => tvFocusIds(controller.lifetime.authority), [controller]);
  const column = ids.surface('server.pages'), rows = ids.surface('server.dashboard');
  const enter = useScreenEntry(theme.isTV && state.admission !== 'denied' ? {regionId: column, childId: 'dashboard'} : undefined, controller.lifetime.current);
  useEffect(() => {void controller.refresh(); return ports.context.events.on('admin.sessions', () => {void controller.refresh();});}, [controller, ports]);
  useEffect(() => {if (state.admission === 'denied') runtime.onDestination({kind: 'settings'});}, [state.admission, runtime]);
  // Ruling17.3: a forbidden direct destination falls back to the first permitted account
  // Settings page. Render that genuine surface while Accounts performs the route transition.
  if (state.admission === 'denied') return <>{deniedFallback}</>;
  const health = healthFacts(state.health, state.storage);
  const facts: ServerFact[] = state.health ? [{id: 'state', text: t(health.degraded ? 'next.shell.health.attention' : 'next.shell.health.normal'), tone: health.degraded ? 'warning' : 'normal'}] : [];
  if (health.uptimeSeconds !== undefined) facts.push({id: 'uptime', text: t('settings.server.health.upFor', {duration: defaultI18n.duration(health.uptimeSeconds)})});
  if (health.freeBytes !== undefined) facts.push({id: 'free', text: t('settings.server.health.free', {bytes: formatBytes(health.freeBytes)})});
  if (health.databaseBytes !== undefined) facts.push({id: 'database', text: t('settings.server.health.database', {bytes: formatBytes(health.databaseBytes)})});
  const role = state.admission;
  return <Screen>
    <ServerBand viewerRole={role} audience="administrators"/>
    <View style={{flex: 1, flexDirection: 'row', gap: theme.isTV ? 80 : 0}}>
      {theme.isTV && <View style={{width: 480}}>
        <Text accessibilityRole="header" style={[shellType(44, 800), {color: theme.colors.text, marginLeft: 20, marginBottom: 24}]}>{t('next.shell.serverSettings')}</Text>
        <ServerHeader serverName={ports.serverName()} viewerRole={role} audience="administrators" variant="group" style={{padding: 20}}/>
        <FocusRegion id={column} entry="dashboard" orientation="vertical" edges={{left: ids.rail, right: rows}} onLayout={enter}>
          <Focusable focusId="dashboard" testID="server-page-dashboard" accessibilityRole="button" accessibilityLabel={t('next.shell.dashboard')} accessibilityState={{selected: true}} focusKind="row" style={{paddingHorizontal: 20, minHeight: 50, borderRadius: 14, backgroundColor: `${theme.colors.accent}29`, justifyContent: 'center'}}><ScreenText>{t('next.shell.dashboard')}</ScreenText></Focusable>
        </FocusRegion>
      </View>}
      <ScrollView contentContainerStyle={{paddingHorizontal: theme.isTV ? 0 : 20, paddingBottom: 80}} style={{flex: 1}}>
        {!theme.isTV && <Button variant="text" size="small" icon="i-left" onPress={() => ports.context.navigation.back(controller.lifetime.authority)}>{t('action.back')}</Button>}
        <ServerHeader serverName={ports.serverName()} viewerRole={role} audience="administrators" facts={facts}/>
        <Text accessibilityRole="header" style={[shellType(theme.isTV ? 44 : 36, 800), {color: theme.colors.text, marginBottom: 30}]}>{t('next.shell.dashboard')}</Text>
        <FocusRegion id={rows} entry={state.sessions[0]?.id} orientation="vertical" edges={{left: theme.isTV ? column : ids.rail}}>
          <Text style={[shellType(theme.isTV ? 20 : 18, 700), {color: theme.colors.textSecondary, marginBottom: 14}]}>{t('next.shell.nowPlaying')}</Text>
          {state.error !== undefined && <StateView {...runtime.error(state.error, () => {void controller.refresh();})}/>}
          {!state.loading && state.error === undefined && !state.sessions.length && <StateView title={t('web.nowPlaying.empty')}/>}
          {state.sessions.map(session => {
            const fraction = playedFraction(session);
            const art = session.item?.art.find(value => value.role === 'backdrop') ?? session.item?.art[0];
            const source = art && runtime.artwork(`/v1/items/${encodeURIComponent(art.id)}/art/${encodeURIComponent(art.kind)}`);
            return <Focusable key={session.id} focusId={session.id} testID={`dashboard-session-${session.id}`} accessibilityRole="text" accessibilityLabel={session.title} focusKind="row" style={{minHeight: theme.isTV ? 120 : 150, flexDirection: 'row', gap: 22, alignItems: 'center', padding: theme.isTV ? 16 : 12, marginBottom: 8, borderRadius: 18, backgroundColor: theme.colors.raised}}>
              {source && <View style={{width: theme.isTV ? 130 : 110, height: theme.isTV ? 76 : 70, borderRadius: 10, overflow: 'hidden'}}><Artwork source={source}/></View>}
              <View style={{flex: 1, gap: 10}}><ScreenText>{session.title}</ScreenText><ScreenText secondary>{[session.user, session.profile !== session.user ? session.profile : '', session.device].filter(Boolean).join('  ')}</ScreenText>
                {session.location !== 'other' && <ScreenText secondary>{t(session.location === 'local' ? 'web.nowPlaying.location.local' : 'web.nowPlaying.location.remote')}</ScreenText>}
                {fraction !== undefined && <View style={{height: 5, borderRadius: 3, backgroundColor: theme.colors.line}}><View style={{height: 5, borderRadius: 3, backgroundColor: theme.colors.accentStrong, width: `${fraction * 100}%`}}/></View>}
              </View>
            </Focusable>;
          })}
          {state.admission === 'owner' && <>
            <Text style={[shellType(theme.isTV ? 20 : 18, 700), {color: theme.colors.textSecondary, marginTop: 36, marginBottom: 14}]}>{t('settings.server.alerts')}</Text>
            {state.alerts.map(alert => <Focusable key={alert.id} focusId={`alert:${alert.id}`} testID={`dashboard-alert-${alert.id}`} accessibilityRole="text" accessibilityLabel={alertName(t, defaultI18n.has, alert.code)} focusKind="row" style={{backgroundColor: theme.colors.raised, borderRadius: 16, padding: 24, marginBottom: 8}}><ScreenText>{alertName(t, defaultI18n.has, alert.code)}</ScreenText></Focusable>)}
            <Text style={[shellType(theme.isTV ? 20 : 18, 700), {color: theme.colors.textSecondary, marginTop: 36, marginBottom: 14}]}>{t('next.shell.backgroundTasks')}</Text>
            {state.jobs.map(job => <Focusable key={job.id} focusId={`job:${job.id}`} testID={`dashboard-job-${job.id}`} accessibilityRole="text" accessibilityLabel={jobName(t, defaultI18n.has, job.kind)} focusKind="row" style={{backgroundColor: theme.colors.raised, borderRadius: 16, padding: 24, marginBottom: 8}}><ScreenText>{jobName(t, defaultI18n.has, job.kind)}</ScreenText></Focusable>)}
          </>}
        </FocusRegion>
      </ScrollView>
    </View>
  </Screen>;
}
