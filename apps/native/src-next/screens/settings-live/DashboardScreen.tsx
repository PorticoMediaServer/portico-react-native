import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {healthFacts} from '../../../../../packages/client-core/src/server-admin/dashboard';
import {formatBytes} from '../../../../../packages/client-core/src/presentation/content';
import {alertName, jobName} from '../../../../../packages/client-core/src/server-admin/console-catalogue';
import {playedFraction} from '../../../../../packages/client-core/src/server-admin/now-playing';
import {sessionFactParts} from '../../../../../packages/client-core/src/presentation/kit-model';
import {Button, Focusable} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {ServerBand, ServerHeader, type ServerFact} from '../../kit/shell';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import {Artwork} from '../../kit/artwork';
import {TVServerPageMenu} from './server/TVServerPageMenu';
import {TVDiskUsage} from './server/TVDiskUsage';
import type {NativeShellRuntime} from '../../shell/runtime';
import {tvFocusIds} from '../../shell/tv-focus';
import {Screen, ScreenText, useScreenEntry} from './Screen';
import type {NativeSettingsLivePorts} from './ports';
import type {NativeDashboardController} from './dashboard-controller';
import {nativeDashboardIdentity} from './dashboard-presentation';
import {NativeOwnerDashboardPhone} from './owner-dashboard/use-owner-dashboard';

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
  // The phone draws the owner Dashboard page from owner-dashboard.html; the TV keeps its Settings surface.
  if (!theme.isTV) return <NativeOwnerDashboardPhone controller={controller} ports={ports} runtime={runtime}/>;
  const health = healthFacts(state.health, state.storage);
  const facts: ServerFact[] = state.health?.facts.database ? [{id: 'state', text: t(health.degraded ? 'next.shell.health.attention' : 'next.shell.health.normal'), tone: health.degraded ? 'warning' : 'normal'}] : [];
  if (health.uptimeSeconds !== undefined) facts.push({id: 'uptime', text: t('settings.server.health.upFor', {duration: defaultI18n.duration(health.uptimeSeconds)})});
  if (health.freeBytes !== undefined) facts.push({id: 'free', text: t('settings.server.health.free', {bytes: formatBytes(health.freeBytes)})});
  if (health.databaseBytes !== undefined) facts.push({id: 'database', text: t('settings.server.health.database', {bytes: formatBytes(health.databaseBytes)})});
  const role = state.admission;
  return <Screen style={theme.isTV ? {paddingTop: 56} : undefined}>
    <ServerBand viewerRole={role} audience="administrators"/>
    <View style={{flex: 1, flexDirection: 'row', gap: theme.isTV ? 80 : 0}}>
      {theme.isTV && <TVServerPageMenu role={role} page="dashboard" serverName={ports.serverName()} runtime={runtime} column={column} rows={rows} rail={ids.rail} onLayout={enter}
        onSelect={page => {if (page !== 'dashboard') ports.context.navigation.open({kind: 'server-settings', page}, controller.lifetime.authority);}}/>}
      <ScrollView contentContainerStyle={{paddingHorizontal: theme.isTV ? 0 : 20, paddingBottom: 80}} style={{flex: 1}}>
        {!theme.isTV && <Button variant="text" size="small" icon="i-left" onPress={() => ports.context.navigation.back(controller.lifetime.authority)}>{t('action.back')}</Button>}
        <View style={theme.isTV ? {height: 60, overflow: 'hidden'} : undefined}><ServerHeader serverName={ports.serverName()} viewerRole={role} audience="administrators" facts={theme.isTV ? [] : facts}/></View>
        <Text accessibilityRole="header" style={[shellType(theme.isTV ? 44 : 36, 800), {color: theme.colors.text, marginBottom: theme.isTV ? 18 : 30}]}>{t('next.shell.dashboard')}</Text>
        {theme.isTV && <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 26, minHeight: 32, marginBottom: 26}}>{facts.map(fact => <View key={fact.id} style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>{fact.tone && fact.tone !== 'muted' && <View style={{width: 12, height: 12, borderRadius: 6, backgroundColor: fact.tone === 'warning' ? theme.colors.amber : theme.colors.healthy}}/>}<Text style={[shellType(22, fact.tone ? 700 : 400), {color: fact.tone === 'normal' ? theme.colors.text : theme.colors.textSecondary}]}>{fact.text}</Text></View>)}</View>}
        <FocusRegion id={rows} entry={state.sessions[0]?.id} orientation="vertical" edges={{left: theme.isTV ? column : ids.rail}}>
          <Text style={[shellType(theme.isTV ? 20 : 18, 700), {color: theme.colors.textSecondary, marginBottom: 14}]}>{t('next.shell.nowPlaying')}</Text>
          {state.error !== undefined && <StateView {...runtime.error(state.error, () => {void controller.refresh();})}/>}
          {!state.loading && state.error === undefined && !state.sessions.length && <StateView title={t('web.nowPlaying.empty')}/>}
          {state.sessions.map(session => {
            const fraction = playedFraction(session);
            const identity = nativeDashboardIdentity(session, runtime.text);
            const sessionFacts = sessionFactParts({...session, kind: session.kind === 'live' || session.kind === 'channel' ? 'channel' : session.kind === 'audio' ? 'audio' : 'vod', location: session.location === 'other' ? 'unknown' : session.location}, runtime.text);
            const location = sessionFacts.find(fact => fact.id === 'location');
            const delivery = sessionFacts.find(fact => fact.id === 'delivery');
            const art = session.item?.art.find(value => value.role === 'backdrop') ?? session.item?.art[0];
            const source = art && runtime.artwork(`/v1/items/${encodeURIComponent(art.id)}/art/${encodeURIComponent(art.kind)}`);
            return <Focusable key={session.id} focusId={session.id} testID={`dashboard-session-${session.id}`} accessibilityRole="text" accessibilityLabel={identity.title} focusKind="row" style={{minHeight: theme.isTV ? 120 : 150, flexDirection: 'row', gap: 22, alignItems: 'center', padding: theme.isTV ? 16 : 12, marginBottom: 8, borderRadius: 18, backgroundColor: theme.colors.raised}}>
              {source && <View style={{width: theme.isTV ? 130 : 110, height: theme.isTV ? 76 : 70, borderRadius: 10, overflow: 'hidden'}}><Artwork source={source}/></View>}
              <View style={{flex: 1, gap: theme.isTV ? 8 : 10}}><Text numberOfLines={1} style={[shellType(theme.isTV ? 26 : 20, 700), {color: theme.colors.text}]}>{identity.title}</Text>
                {identity.secondary.length > 0 && <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 16}}>{identity.secondary.map((value, index) => <Text numberOfLines={1} key={index} style={[shellType(theme.isTV ? 20 : 14), {color: theme.colors.textSecondary, flexShrink: 1}]}>{value}</Text>)}</View>}
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: theme.isTV ? 16 : 10}}>{[session.profile || session.user, session.device, location?.text, delivery?.text].filter(Boolean).map((value, index) => <Text numberOfLines={1} key={index} style={[shellType(theme.isTV ? 20 : 14, index === 0 ? 700 : 400), {color: theme.colors.textSecondary}]}>{value}</Text>)}</View>
              </View>
              {fraction !== undefined && <View style={{width: theme.isTV ? 160 : 80, height: theme.isTV ? 8 : 5, borderRadius: 4, overflow: 'hidden', backgroundColor: theme.colors.line}}><View style={{height: '100%', backgroundColor: theme.colors.accentStrong, width: `${fraction * 100}%`}}/></View>}
            </Focusable>;
          })}
          {state.admission === 'owner' && <>
            <Text style={[shellType(theme.isTV ? 20 : 18, 700), {color: theme.colors.textSecondary, marginTop: 36, marginBottom: 14}]}>{t('settings.server.alerts')}</Text>
            {state.alerts.map(alert => <Focusable key={alert.id} focusId={`alert:${alert.id}`} testID={`dashboard-alert-${alert.id}`} accessibilityRole="text" accessibilityLabel={alertName(t, defaultI18n.has, alert.code)} focusKind="row" style={{backgroundColor: theme.colors.raised, borderRadius: 16, padding: 24, marginBottom: 8}}><ScreenText>{alertName(t, defaultI18n.has, alert.code)}</ScreenText></Focusable>)}
            <Text style={[shellType(theme.isTV ? 20 : 18, 700), {color: theme.colors.textSecondary, marginTop: 36, marginBottom: 14}]}>{t('next.shell.backgroundTasks')}</Text>
            {state.jobs.map(job => <Focusable key={job.id} focusId={`job:${job.id}`} testID={`dashboard-job-${job.id}`} accessibilityRole="text" accessibilityLabel={jobName(t, defaultI18n.has, job.kind)} focusKind="row" style={{backgroundColor: theme.colors.raised, borderRadius: 16, padding: 24, marginBottom: 8}}><ScreenText>{jobName(t, defaultI18n.has, job.kind)}</ScreenText></Focusable>)}
            <TVDiskUsage context={ports.context} runtime={runtime} freeBytes={health.freeBytes} databaseBytes={health.databaseBytes}/>
          </>}
        </FocusRegion>
      </ScrollView>
    </View>
  </Screen>;
}
